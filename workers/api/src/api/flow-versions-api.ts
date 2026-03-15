/* =========================================================
IAI FLOW ENGINE
Flow Versions API
Workspace-scoped version history, snapshots, rollback support
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import {
  validateWorkflowDefinition,
  type WorkflowValidatorDefinition
} from "../flow/workflow-validator";
import {
  ensureWorkspaceFlowSchema,
  getScopedFlow,
  type ScopedFlowRow
} from "../flow/workspace-flow-scope";

interface FlowVersionRow {
  id: string;
  flow_id: string;
  workspace_id: string;
  version: number;
  snapshot_json: string;
  status: string;
  created_by: string;
  created_at: string;
}

export async function flowVersionsAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const versionsMatch = pathname.match(/^\/api\/flows\/([^/]+)\/versions$/);
  if (versionsMatch && method === "GET") {
    return listFlowVersions(versionsMatch[1], request, env);
  }

  if (versionsMatch && method === "POST") {
    return createFlowVersion(versionsMatch[1], request, env);
  }

  const versionMatch = pathname.match(/^\/api\/flows\/([^/]+)\/versions\/(\d+)$/);
  if (versionMatch && method === "GET") {
    return getFlowVersion(versionMatch[1], Number(versionMatch[2]), request, env);
  }

  const rollbackMatch = pathname.match(/^\/api\/flows\/([^/]+)\/versions\/(\d+)\/restore$/);
  if (rollbackMatch && method === "POST") {
    return restoreFlowVersion(
      rollbackMatch[1],
      Number(rollbackMatch[2]),
      request,
      env
    );
  }

  return null;
}

/* =========================================================
LIST FLOW VERSIONS
========================================================= */

async function listFlowVersions(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureFlowVersionsSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found in current workspace"
      },
      { status: 404 }
    );
  }

  const result = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      workspace_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    FROM flow_versions
    WHERE flow_id = ? AND workspace_id = ?
    ORDER BY version DESC
  `)
    .bind(flowId, identity.workspaceId)
    .all<FlowVersionRow>();

  const items = (result.results || []).map((row) => ({
    id: row.id,
    flowId: row.flow_id,
    workspaceId: row.workspace_id,
    version: row.version,
    snapshot: safeParseJson(row.snapshot_json),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at
  }));

  return jsonResponse({
    ok: true,
    items
  });
}

/* =========================================================
GET FLOW VERSION
========================================================= */

async function getFlowVersion(
  flowId: string,
  version: number,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureFlowVersionsSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found in current workspace"
      },
      { status: 404 }
    );
  }

  const row = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      workspace_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    FROM flow_versions
    WHERE flow_id = ? AND workspace_id = ? AND version = ?
    LIMIT 1
  `)
    .bind(flowId, identity.workspaceId, version)
    .first<FlowVersionRow>();

  if (!row) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_version_not_found",
        message: "Flow version not found in current workspace"
      },
      { status: 404 }
    );
  }

  return jsonResponse({
    ok: true,
    item: {
      id: row.id,
      flowId: row.flow_id,
      workspaceId: row.workspace_id,
      version: row.version,
      snapshot: safeParseJson(row.snapshot_json),
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at
    }
  });
}

/* =========================================================
CREATE FLOW VERSION SNAPSHOT
========================================================= */

async function createFlowVersion(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureFlowVersionsSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found in current workspace"
      },
      { status: 404 }
    );
  }

  const snapshot = buildSnapshot(flow);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO flow_versions (
      id,
      flow_id,
      workspace_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      flow.id,
      identity.workspaceId,
      flow.version,
      JSON.stringify(snapshot),
      flow.status,
      identity.userId,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.version_created",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        version: flow.version,
        status: flow.status
      }
    },
    env
  );

  return jsonResponse(
    {
      ok: true,
      item: {
        flowId: flow.id,
        workspaceId: identity.workspaceId,
        version: flow.version,
        snapshot,
        status: flow.status,
        createdBy: identity.userId,
        createdAt: now
      }
    },
    { status: 201 }
  );
}

/* =========================================================
RESTORE FLOW VERSION
========================================================= */

async function restoreFlowVersion(
  flowId: string,
  version: number,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureFlowVersionsSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found in current workspace"
      },
      { status: 404 }
    );
  }

  const versionRow = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      workspace_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    FROM flow_versions
    WHERE flow_id = ? AND workspace_id = ? AND version = ?
    LIMIT 1
  `)
    .bind(flowId, identity.workspaceId, version)
    .first<FlowVersionRow>();

  if (!versionRow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_version_not_found",
        message: "Flow version not found in current workspace"
      },
      { status: 404 }
    );
  }

  const snapshot = safeParseJson(versionRow.snapshot_json);
  const definition = normalizeDefinition(snapshot, flow.name, flowId);

  const validation = validateWorkflowDefinition(
    definition,
    identity.role
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
        message: "Stored version cannot be restored because validation failed",
        validation
      },
      { status: 400 }
    );
  }

  const nextVersion = Number(flow.version || 1) + 1;
  const now = new Date().toISOString();

  const storedDefinition = {
    ...definition,
    id: flowId,
    name: definition.name || flow.name
  };

  await env.DB.prepare(`
    UPDATE flows
    SET
      name = ?,
      status = ?,
      version = ?,
      definition_json = ?,
      updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `)
    .bind(
      storedDefinition.name,
      flow.status,
      nextVersion,
      JSON.stringify(storedDefinition),
      now,
      flowId,
      identity.workspaceId
    )
    .run();

  await env.DB.prepare(`
    INSERT INTO flow_versions (
      id,
      flow_id,
      workspace_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      flowId,
      identity.workspaceId,
      nextVersion,
      JSON.stringify({
        ...storedDefinition,
        restoredFromVersion: version
      }),
      flow.status,
      identity.userId,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.version_restored",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        restoredFromVersion: version,
        newVersion: nextVersion,
        validation
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      flowId,
      workspaceId: identity.workspaceId,
      restoredFromVersion: version,
      newVersion: nextVersion,
      updatedAt: now,
      validation
    }
  });
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureFlowVersionsSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_versions (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_versions_workspace_flow
    ON flow_versions (workspace_id, flow_id, version DESC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_versions_workspace_created
    ON flow_versions (workspace_id, created_at DESC)
  `).run();
}

/* =========================================================
HELPERS
========================================================= */

function buildSnapshot(flow: ScopedFlowRow): Record<string, unknown> {
  const definition = safeParseJson(flow.definition_json);

  return {
    id: flow.id,
    workspaceId: flow.workspace_id,
    createdBy: flow.created_by,
    name: flow.name,
    status: flow.status,
    version: flow.version,
    definition,
    createdAt: flow.created_at,
    updatedAt: flow.updated_at
  };
}

function normalizeDefinition(
  input: unknown,
  fallbackName: string,
  flowId: string
): WorkflowValidatorDefinition {
  const base = isRecord(input) ? input : {};
  const definition = isRecord(base.definition) ? base.definition : base;

  return {
    id: typeof definition.id === "string" && definition.id.trim() ? definition.id.trim() : flowId,
    name: typeof definition.name === "string" && definition.name.trim() ? definition.name.trim() : fallbackName,
    entry: typeof definition.entry === "string" && definition.entry.trim() ? definition.entry.trim() : null,
    nodes: Array.isArray(definition.nodes) ? definition.nodes : [],
    edges: Array.isArray(definition.edges) ? definition.edges : []
  };
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/* =========================================================
RESPONSE
========================================================= */

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
