/* =========================================================
IAI FLOW ENGINE
Flow Collaboration Lock API
Workspace-scoped builder lock to prevent edit collisions
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import { ensureWorkspaceFlowSchema, getScopedFlow } from "../flow/workspace-flow-scope";

const DEFAULT_LOCK_TTL_SECONDS = 300;

interface CollaborationLockRow {
  id: string;
  flow_id: string;
  workspace_id: string;
  lock_token: string;
  holder_user_id: string;
  holder_display_name: string;
  holder_role: string;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export async function flowCollaborationLockAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const statusMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/lock$/);
  if (statusMatch && method === "GET") {
    return getLockStatus(statusMatch[1], request, env);
  }

  if (statusMatch && method === "POST") {
    return acquireLock(statusMatch[1], request, env);
  }

  const renewMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/lock\/renew$/);
  if (renewMatch && method === "POST") {
    return renewLock(renewMatch[1], request, env);
  }

  const releaseMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/lock\/release$/);
  if (releaseMatch && method === "POST") {
    return releaseLock(releaseMatch[1], request, env);
  }

  const forceMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/lock\/force$/);
  if (forceMatch && method === "POST") {
    return forceTakeoverLock(forceMatch[1], request, env);
  }

  return null;
}

/* =========================================================
GET LOCK STATUS
========================================================= */

async function getLockStatus(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureCollaborationLockSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  await expireStaleLocks(flowId, identity.workspaceId, env);

  const row = await getActiveLock(flowId, identity.workspaceId, env);

  return jsonResponse({
    ok: true,
    item: row ? mapLockRow(row, identity.userId) : null
  });
}

/* =========================================================
ACQUIRE LOCK
========================================================= */

async function acquireLock(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureCollaborationLockSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  await expireStaleLocks(flowId, identity.workspaceId, env);

  const body = await readJson<Record<string, unknown>>(request);
  const ttlSeconds = clampTtl(body.ttlSeconds);
  const activeLock = await getActiveLock(flowId, identity.workspaceId, env);

  if (activeLock) {
    if (activeLock.holder_user_id === identity.userId) {
      const nextExpiresAt = computeExpiry(ttlSeconds);
      await env.DB.prepare(`
        UPDATE flow_collaboration_locks
        SET
          expires_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
        .bind(nextExpiresAt, new Date().toISOString(), activeLock.id)
        .run();

      const refreshed = await getActiveLock(flowId, identity.workspaceId, env);

      return jsonResponse({
        ok: true,
        reused: true,
        item: refreshed ? mapLockRow(refreshed, identity.userId) : null
      });
    }

    return jsonResponse(
      {
        ok: false,
        error: "lock_conflict",
        message: "This flow is currently being edited by another user",
        item: mapLockRow(activeLock, identity.userId)
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const lockToken = crypto.randomUUID();
  const lockId = crypto.randomUUID();
  const expiresAt = computeExpiry(ttlSeconds);

  await env.DB.prepare(`
    INSERT INTO flow_collaboration_locks (
      id,
      flow_id,
      workspace_id,
      lock_token,
      holder_user_id,
      holder_display_name,
      holder_role,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      lockId,
      flowId,
      identity.workspaceId,
      lockToken,
      identity.userId,
      identity.displayName || identity.userId,
      identity.role,
      "active",
      expiresAt,
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.builder_lock_acquired",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        lockId,
        lockToken,
        expiresAt
      }
    },
    env
  );

  const created = await getActiveLock(flowId, identity.workspaceId, env);

  return jsonResponse(
    {
      ok: true,
      item: created ? mapLockRow(created, identity.userId) : null
    },
    { status: 201 }
  );
}

/* =========================================================
RENEW LOCK
========================================================= */

async function renewLock(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureCollaborationLockSchema(env);

  const body = await readJson<Record<string, unknown>>(request);
  const lockToken =
    typeof body.lockToken === "string" && body.lockToken.trim()
      ? body.lockToken.trim()
      : "";

  if (!lockToken) {
    return errorResponse("lock_token_required", "lockToken is required", 400);
  }

  const ttlSeconds = clampTtl(body.ttlSeconds);

  await expireStaleLocks(flowId, identity.workspaceId, env);

  const row = await env.DB.prepare(`
    SELECT *
    FROM flow_collaboration_locks
    WHERE flow_id = ?
      AND workspace_id = ?
      AND lock_token = ?
      AND holder_user_id = ?
      AND status = 'active'
    LIMIT 1
  `)
    .bind(flowId, identity.workspaceId, lockToken, identity.userId)
    .first<CollaborationLockRow>();

  if (!row) {
    return errorResponse("lock_not_found", "Active lock not found for current user", 404);
  }

  const nextExpiresAt = computeExpiry(ttlSeconds);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE flow_collaboration_locks
    SET
      expires_at = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(nextExpiresAt, now, row.id)
    .run();

  const updated = await getActiveLock(flowId, identity.workspaceId, env);

  return jsonResponse({
    ok: true,
    item: updated ? mapLockRow(updated, identity.userId) : null
  });
}

/* =========================================================
RELEASE LOCK
========================================================= */

async function releaseLock(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureCollaborationLockSchema(env);

  const body = await readJson<Record<string, unknown>>(request);
  const lockToken =
    typeof body.lockToken === "string" && body.lockToken.trim()
      ? body.lockToken.trim()
      : "";

  if (!lockToken) {
    return errorResponse("lock_token_required", "lockToken is required", 400);
  }

  const row = await env.DB.prepare(`
    SELECT *
    FROM flow_collaboration_locks
    WHERE flow_id = ?
      AND workspace_id = ?
      AND lock_token = ?
      AND holder_user_id = ?
      AND status = 'active'
    LIMIT 1
  `)
    .bind(flowId, identity.workspaceId, lockToken, identity.userId)
    .first<CollaborationLockRow>();

  if (!row) {
    return errorResponse("lock_not_found", "Active lock not found for current user", 404);
  }

  await env.DB.prepare(`
    UPDATE flow_collaboration_locks
    SET
      status = 'released',
      updated_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), row.id)
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.builder_lock_released",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        lockId: row.id
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    released: true
  });
}

/* =========================================================
FORCE TAKEOVER
========================================================= */

async function forceTakeoverLock(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);

  if (!(identity.role === "owner" || identity.role === "admin")) {
    return errorResponse(
      "lock_force_forbidden",
      "Only owner or admin can force takeover a builder lock",
      403
    );
  }

  await ensureCollaborationLockSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  await expireStaleLocks(flowId, identity.workspaceId, env);

  const activeLock = await getActiveLock(flowId, identity.workspaceId, env);

  if (activeLock) {
    await env.DB.prepare(`
      UPDATE flow_collaboration_locks
      SET
        status = 'force_released',
        updated_at = ?
      WHERE id = ?
    `)
      .bind(new Date().toISOString(), activeLock.id)
      .run();
  }

  const now = new Date().toISOString();
  const lockId = crypto.randomUUID();
  const lockToken = crypto.randomUUID();
  const expiresAt = computeExpiry(DEFAULT_LOCK_TTL_SECONDS);

  await env.DB.prepare(`
    INSERT INTO flow_collaboration_locks (
      id,
      flow_id,
      workspace_id,
      lock_token,
      holder_user_id,
      holder_display_name,
      holder_role,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      lockId,
      flowId,
      identity.workspaceId,
      lockToken,
      identity.userId,
      identity.displayName || identity.userId,
      identity.role,
      "active",
      expiresAt,
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.builder_lock_force_taken",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        previousLockId: activeLock?.id || null,
        newLockId: lockId
      }
    },
    env
  );

  const created = await getActiveLock(flowId, identity.workspaceId, env);

  return jsonResponse({
    ok: true,
    forced: true,
    item: created ? mapLockRow(created, identity.userId) : null
  });
}

/* =========================================================
LOCK HELPERS
========================================================= */

async function getActiveLock(
  flowId: string,
  workspaceId: string,
  env: Env
): Promise<CollaborationLockRow | null> {
  return env.DB.prepare(`
    SELECT *
    FROM flow_collaboration_locks
    WHERE flow_id = ?
      AND workspace_id = ?
      AND status = 'active'
      AND expires_at > ?
    ORDER BY updated_at DESC
    LIMIT 1
  `)
    .bind(flowId, workspaceId, new Date().toISOString())
    .first<CollaborationLockRow>();
}

async function expireStaleLocks(
  flowId: string,
  workspaceId: string,
  env: Env
): Promise<void> {
  await env.DB.prepare(`
    UPDATE flow_collaboration_locks
    SET
      status = 'expired',
      updated_at = ?
    WHERE flow_id = ?
      AND workspace_id = ?
      AND status = 'active'
      AND expires_at <= ?
  `)
    .bind(
      new Date().toISOString(),
      flowId,
      workspaceId,
      new Date().toISOString()
    )
    .run();
}

function mapLockRow(
  row: CollaborationLockRow,
  currentUserId: string
): Record<string, unknown> {
  return {
    id: row.id,
    flowId: row.flow_id,
    workspaceId: row.workspace_id,
    lockToken: row.lock_token,
    holderUserId: row.holder_user_id,
    holderDisplayName: row.holder_display_name,
    holderRole: row.holder_role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isMine: row.holder_user_id === currentUserId
  };
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureCollaborationLockSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_collaboration_locks (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      lock_token TEXT NOT NULL UNIQUE,
      holder_user_id TEXT NOT NULL,
      holder_display_name TEXT NOT NULL,
      holder_role TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_collaboration_locks_workspace_flow
    ON flow_collaboration_locks (workspace_id, flow_id, updated_at DESC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_collaboration_locks_workspace_status
    ON flow_collaboration_locks (workspace_id, status, expires_at)
  `).run();
}

/* =========================================================
UTILS
========================================================= */

function clampTtl(input: unknown): number {
  const value =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number.parseInt(input, 10)
        : DEFAULT_LOCK_TTL_SECONDS;

  if (!Number.isFinite(value)) return DEFAULT_LOCK_TTL_SECONDS;
  return Math.min(1800, Math.max(30, value));
}

function computeExpiry(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {} as T;
  }
  return (await request.json()) as T;
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, authorization, x-user-id, x-workspace-id, x-internal-api-key"
  );

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse(
    {
      ok: false,
      error: code,
      message
    },
    { status }
  );
}
