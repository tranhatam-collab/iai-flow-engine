/* =========================================================
IAI FLOW ENGINE
Flow Versions API
Version history, snapshots, rollback support
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import {
  validateWorkflowDefinition,
  type WorkflowValidatorDefinition
} from "../flow/workflow-validator";

interface FlowRow {
  id: string;
  name: string;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

interface FlowVersionRow {
  id: string;
  flow_id: string;
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

async function listFlowVersions(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureFlowVersionsSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    FROM flow_versions
    WHERE flow_id = ?
    ORDER BY version DESC
  `)
    .bind(flowId)
    .all<FlowVersionRow>();

  const items = (result.results || []).map((row) => ({
    id: row.id,
    flowId: row.flow_id,
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

async function getFlowVersion(
  flowId: string,
  version: number,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureFlowVersionsSchema(env);

  const row = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    FROM flow_versions
    WHERE flow_id = ? AND version = ?
    LIMIT 1
  `)
    .bind(flowId, version)
    .first<FlowVersionRow>();

  if (!row) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_version_not_found",
        message: "Flow version not found"
      },
      { status: 404 }
    );
  }

  return jsonResponse({
    ok: true,
    item: {
      id: row.id,
      flowId: row.flow_id,
      version: row.version,
      snapshot: safeParseJson(row.snapshot_json),
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at
    }
  });
}

async function createFlowVersion(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureFlowVersionsSchema(env);

  const flow = await env.DB.prepare(`
    SELECT
      id,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    FROM flows
    WHERE id = ?
    LIMIT 1
  `)
    .bind(flowId)
    .first<FlowRow>();

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
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
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      flow.id,
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

async function restoreFlowVersion(
  flowId: string,
  version: number,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureFlowVersionsSchema(env);

  const flow = await env.DB.prepare(`
    SELECT
      id,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    FROM flows
    WHERE id = ?
    LIMIT 1
  `)
    .bind(flowId)
    .first<FlowRow>();

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
      },
      { status: 404 }
    );
  }

  const versionRow = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    FROM flow_versions
    WHERE flow_id = ? AND version = ?
    LIMIT 1
  `)
    .bind(flowId, version)
    .first<FlowVersionRow>();

  if (!versionRow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_version_not_found",
        message: "Flow version not found"
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

  await env.DB.prepare(`
    UPDATE flows
    SET
      name = ?,
      status = ?,
      version = ?,
      definition_json = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      definition.name || flow.name,
      flow.status,
      nextVersion,
      JSON.stringify({
        ...definition,
        id: flowId
      }),
      now,
      flowId
    )
    .run();

  await env.DB.prepare(`
    INSERT INTO flow_versions (
      id,
      flow_id,
      version,
      snapshot_json,
      status,
      created_by,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      flowId,
      nextVersion,
      JSON.stringify({
        ...definition,
        id: flowId
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
        restoredFromVersion: version,
        newVersion: nextVersion
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      flowId,
      restoredFromVersion: version,
      newVersion: nextVersion,
      updatedAt: now,
      validation
    }
  });
}

async function ensureFlowVersionsSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_versions (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id
    ON flow_versions (flow_id, version DESC)
  `).run();
}

function buildSnapshot(flow: FlowRow): Record<string, unknown> {
  const definition = safeParseJson(flow.definition_json);

  return {
    id: flow.id,
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
