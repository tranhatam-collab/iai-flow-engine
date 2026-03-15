/* =========================================================
IAI FLOW ENGINE
Flows API
Production-grade flow CRUD + validation + runtime execution
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import {
  validateWorkflowDefinition,
  type WorkflowValidatorDefinition
} from "../flow/workflow-validator";
import { runFlowEngine, ensureFlowEngineSchema } from "../flow/flow-engine";

export async function flowsAPI(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/flows" && method === "GET") {
    return listFlows(request, env);
  }

  if (pathname === "/api/flows" && method === "POST") {
    return createFlow(request, env);
  }

  const flowMatch = pathname.match(/^\/api\/flows\/([^/]+)$/);
  if (flowMatch && method === "GET") {
    return getFlow(flowMatch[1], request, env);
  }

  if (flowMatch && method === "PUT") {
    return updateFlow(flowMatch[1], request, env);
  }

  if (flowMatch && method === "DELETE") {
    return deleteFlow(flowMatch[1], request, env);
  }

  const flowRunMatch = pathname.match(/^\/api\/flows\/([^/]+)\/run$/);
  if (flowRunMatch && method === "POST") {
    return runFlow(flowRunMatch[1], request, env);
  }

  return null;
}

/* =========================================================
TYPES
========================================================= */

interface FlowRecord {
  id: string;
  name: string;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

interface CreateOrUpdateFlowBody {
  name?: string;
  status?: string;
  definition?: WorkflowValidatorDefinition | Record<string, unknown>;
}

/* =========================================================
LIST FLOWS
========================================================= */

async function listFlows(request: Request, env: Env): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureFlowsSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    FROM flows
    ORDER BY updated_at DESC
  `).all<FlowRecord>();

  const items = (result.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    version: row.version,
    definition: safeParseJson(row.definition_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return jsonResponse({
    ok: true,
    items
  });
}

/* =========================================================
GET FLOW
========================================================= */

async function getFlow(flowId: string, request: Request, env: Env): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureFlowsSchema(env);

  const row = await env.DB.prepare(`
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
    .first<FlowRecord>();

  if (!row) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
      },
      { status: 404 }
    );
  }

  return jsonResponse({
    ok: true,
    item: {
      id: row.id,
      name: row.name,
      status: row.status,
      version: row.version,
      definition: safeParseJson(row.definition_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  });
}

/* =========================================================
CREATE FLOW
========================================================= */

async function createFlow(request: Request, env: Env): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.create");

  await ensureFlowsSchema(env);

  const body = await readJson<CreateOrUpdateFlowBody>(request);

  const name = sanitizeText(body.name, "Untitled Flow");
  const status = sanitizeFlowStatus(body.status);
  const definition = normalizeDefinition(body.definition, name);

  const validation = validateWorkflowDefinition(
    definition,
    identity.role
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
        message: "Workflow validation failed",
        validation
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const flowId = crypto.randomUUID();

  const storedDefinition = {
    ...definition,
    id: flowId,
    name
  };

  await env.DB.prepare(`
    INSERT INTO flows (
      id,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      flowId,
      name,
      status,
      1,
      JSON.stringify(storedDefinition),
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.created",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        name,
        status,
        validation
      }
    },
    env
  );

  return jsonResponse(
    {
      ok: true,
      item: {
        id: flowId,
        name,
        status,
        version: 1,
        definition: storedDefinition,
        validation,
        createdAt: now,
        updatedAt: now
      }
    },
    { status: 201 }
  );
}

/* =========================================================
UPDATE FLOW
========================================================= */

async function updateFlow(flowId: string, request: Request, env: Env): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureFlowsSchema(env);

  const existing = await env.DB.prepare(`
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
    .first<FlowRecord>();

  if (!existing) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
      },
      { status: 404 }
    );
  }

  const body = await readJson<CreateOrUpdateFlowBody>(request);

  const nextName = sanitizeText(body.name, existing.name);
  const nextStatus = sanitizeFlowStatus(body.status || existing.status);

  const currentDefinition = safeParseJson(existing.definition_json);
  const nextDefinition = normalizeDefinition(
    body.definition ?? currentDefinition,
    nextName
  );

  const storedDefinition = {
    ...nextDefinition,
    id: flowId,
    name: nextName
  };

  const validation = validateWorkflowDefinition(
    storedDefinition,
    identity.role
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
        message: "Workflow validation failed",
        validation
      },
      { status: 400 }
    );
  }

  const nextVersion = Number(existing.version || 1) + 1;
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
      nextName,
      nextStatus,
      nextVersion,
      JSON.stringify(storedDefinition),
      now,
      flowId
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.updated",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        name: nextName,
        status: nextStatus,
        version: nextVersion,
        validation
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      id: flowId,
      name: nextName,
      status: nextStatus,
      version: nextVersion,
      definition: storedDefinition,
      validation,
      updatedAt: now
    }
  });
}

/* =========================================================
DELETE FLOW
========================================================= */

async function deleteFlow(flowId: string, request: Request, env: Env): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.delete");

  await ensureFlowsSchema(env);

  const existing = await env.DB.prepare(`
    SELECT id, name, status
    FROM flows
    WHERE id = ?
    LIMIT 1
  `)
    .bind(flowId)
    .first<{ id: string; name: string; status: string }>();

  if (!existing) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
      },
      { status: 404 }
    );
  }

  const result = await env.DB.prepare(`
    DELETE FROM flows
    WHERE id = ?
  `)
    .bind(flowId)
    .run();

  if (!result.success) {
    return jsonResponse(
      {
        ok: false,
        error: "delete_failed",
        message: "Unable to delete flow"
      },
      { status: 500 }
    );
  }

  await writeAuditLog(
    identity,
    {
      eventType: "flow.deleted",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        name: existing.name,
        status: existing.status
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    deleted: true,
    id: flowId
  });
}

/* =========================================================
RUN FLOW
========================================================= */

async function runFlow(flowId: string, request: Request, env: Env): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.run");

  await ensureFlowsSchema(env);
  await ensureFlowEngineSchema(env);

  const existing = await env.DB.prepare(`
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
    .first<FlowRecord>();

  if (!existing) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
      },
      { status: 404 }
    );
  }

  const definition = normalizeDefinition(
    safeParseJson(existing.definition_json),
    existing.name
  );

  const validation = validateWorkflowDefinition(
    {
      ...definition,
      id: flowId,
      name: existing.name
    },
    identity.role
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
        message: "Workflow validation failed before run",
        validation
      },
      { status: 400 }
    );
  }

  const payload = await readJson<Record<string, unknown>>(request);

  const result = await runFlowEngine({
    flowId,
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    payload: payload || {},
    env
  });

  await writeAuditLog(
    identity,
    {
      eventType: "flow.executed",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        executionId: result.executionId || null,
        status: result.status || "unknown",
        success: result.ok === true,
        validation
      }
    },
    env
  );

  return jsonResponse(
    result,
    {
      status: result.ok ? 201 : 400
    }
  );
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureFlowsSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flows_updated_at
    ON flows (updated_at DESC)
  `).run();
}

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeDefinition(
  input: unknown,
  fallbackName: string
): WorkflowValidatorDefinition {
  const base = isRecord(input) ? input : {};
  const nodes = Array.isArray(base.nodes) ? base.nodes : [];
  const edges = Array.isArray(base.edges) ? base.edges : [];

  return {
    id: typeof base.id === "string" && base.id.trim() ? base.id.trim() : undefined,
    name: typeof base.name === "string" && base.name.trim() ? base.name.trim() : fallbackName,
    entry: typeof base.entry === "string" && base.entry.trim() ? base.entry.trim() : null,
    nodes: nodes
      .filter(isRecord)
      .map((node) => ({
        id: typeof node.id === "string" ? node.id.trim() : "",
        type: typeof node.type === "string" ? node.type.trim() : "",
        name: typeof node.name === "string" && node.name.trim() ? node.name.trim() : undefined,
        config: isRecord(node.config) ? node.config : {}
      })),
    edges
  };
}

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeFlowStatus(value: unknown): string {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    status === "draft" ||
    status === "published" ||
    status === "archived" ||
    status === "active"
  ) {
    return status;
  }

  return "draft";
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
