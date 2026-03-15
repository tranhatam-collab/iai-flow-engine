/* =========================================================
IAI FLOW ENGINE
Flow Node Inspector API
Workspace-scoped node execution inspector for builder frontend
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";

interface ExecutionLogRow {
  execution_id: string;
  workflow_id: string | null;
  workspace_id: string;
  user_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  final_output_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export async function flowNodeInspectorAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const executionStepsMatch = pathname.match(/^\/api\/executions\/([^/]+)\/steps$/);
  if (executionStepsMatch && method === "GET") {
    return getExecutionSteps(executionStepsMatch[1], request, env);
  }

  const executionNodeMatch = pathname.match(/^\/api\/executions\/([^/]+)\/steps\/([^/]+)$/);
  if (executionNodeMatch && method === "GET") {
    return getExecutionNodeStep(
      executionNodeMatch[1],
      decodeURIComponent(executionNodeMatch[2]),
      request,
      env
    );
  }

  return null;
}

/* =========================================================
GET ALL STEPS FOR ONE EXECUTION
========================================================= */

async function getExecutionSteps(
  executionId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "execution.read");

  await ensureInspectorSchema(env);

  const execution = await getExecutionRow(executionId, env);

  if (!execution) {
    return errorResponse("execution_not_found", "Execution not found", 404);
  }

  if (execution.workspace_id !== identity.workspaceId) {
    return errorResponse(
      "execution_forbidden",
      "Execution does not belong to current workspace",
      403
    );
  }

  const steps = await loadExecutionSteps(executionId, identity.workspaceId, env);

  return jsonResponse({
    ok: true,
    item: {
      execution: mapExecution(execution),
      steps: steps.map(mapStep)
    }
  });
}

/* =========================================================
GET ONE NODE STEP BY NODE ID
========================================================= */

async function getExecutionNodeStep(
  executionId: string,
  nodeId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "execution.read");

  await ensureInspectorSchema(env);

  const execution = await getExecutionRow(executionId, env);

  if (!execution) {
    return errorResponse("execution_not_found", "Execution not found", 404);
  }

  if (execution.workspace_id !== identity.workspaceId) {
    return errorResponse(
      "execution_forbidden",
      "Execution does not belong to current workspace",
      403
    );
  }

  const row = await env.DB.prepare(`
    SELECT
      id,
      execution_id,
      workflow_id,
      workspace_id,
      node_id,
      node_type,
      node_name,
      success,
      started_at,
      completed_at,
      input_json,
      output_json,
      error_message,
      created_at
    FROM execution_step_logs
    WHERE execution_id = ?
      AND workspace_id = ?
      AND node_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `)
    .bind(executionId, identity.workspaceId, nodeId)
    .first<any>();

  if (!row) {
    return errorResponse("execution_step_not_found", "Execution step not found", 404);
  }

  return jsonResponse({
    ok: true,
    item: {
      execution: mapExecution(execution),
      step: mapStep(row)
    }
  });
}

/* =========================================================
DATA HELPERS
========================================================= */

async function getExecutionRow(
  executionId: string,
  env: Env
): Promise<ExecutionLogRow | null> {
  return env.DB.prepare(`
    SELECT
      execution_id,
      workflow_id,
      workspace_id,
      user_id,
      status,
      started_at,
      completed_at,
      final_output_json,
      error_message,
      created_at,
      updated_at
    FROM execution_logs
    WHERE execution_id = ?
    LIMIT 1
  `)
    .bind(executionId)
    .first<ExecutionLogRow>();
}

async function loadExecutionSteps(
  executionId: string,
  workspaceId: string,
  env: Env
): Promise<any[]> {
  const result = await env.DB.prepare(`
    SELECT
      id,
      execution_id,
      workflow_id,
      workspace_id,
      node_id,
      node_type,
      node_name,
      success,
      started_at,
      completed_at,
      input_json,
      output_json,
      error_message,
      created_at
    FROM execution_step_logs
    WHERE execution_id = ?
      AND workspace_id = ?
    ORDER BY created_at ASC
  `)
    .bind(executionId, workspaceId)
    .all<any>();

  return result.results || [];
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureInspectorSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      final_output_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS execution_step_logs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      workflow_id TEXT,
      workspace_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      node_name TEXT,
      success INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_step_logs_execution
    ON execution_step_logs (execution_id, created_at ASC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_step_logs_workspace_execution
    ON execution_step_logs (workspace_id, execution_id, created_at ASC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_step_logs_node
    ON execution_step_logs (workspace_id, execution_id, node_id, created_at DESC)
  `).run();
}

/* =========================================================
MAPPERS
========================================================= */

function mapExecution(row: ExecutionLogRow): Record<string, unknown> {
  const durationMs = computeDurationMs(row.started_at, row.completed_at);

  return {
    executionId: row.execution_id,
    flowId: row.workflow_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs,
    durationSeconds: typeof durationMs === "number" ? round2(durationMs / 1000) : null,
    finalOutput: safeParseJson(row.final_output_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapStep(row: any): Record<string, unknown> {
  const durationMs = computeDurationMs(row.started_at, row.completed_at);

  return {
    id: row.id,
    executionId: row.execution_id,
    flowId: row.workflow_id,
    workspaceId: row.workspace_id,
    nodeId: row.node_id,
    nodeType: row.node_type,
    nodeName: row.node_name,
    success: normalizeBoolean(row.success),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs,
    durationSeconds: typeof durationMs === "number" ? round2(durationMs / 1000) : null,
    input: safeParseJson(row.input_json),
    output: safeParseJson(row.output_json),
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

/* =========================================================
UTILS
========================================================= */

function computeDurationMs(
  startedAt: string | null,
  completedAt: string | null
): number | null {
  if (!startedAt || !completedAt) return null;

  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);

  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
