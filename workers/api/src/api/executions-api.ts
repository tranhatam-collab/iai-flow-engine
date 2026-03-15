import type { Env } from "../index";
import { runFlowById } from "../runtime/flow-runner";

export async function executionsAPI(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/executions" && method === "GET") {
    return listExecutions(env);
  }

  const flowRunMatch = pathname.match(/^\/api\/flows\/([^/]+)\/run$/);
  if (flowRunMatch && method === "POST") {
    return runFlow(flowRunMatch[1], request, env);
  }

  const executionMatch = pathname.match(/^\/api\/executions\/([^/]+)$/);
  if (executionMatch && method === "GET") {
    return getExecution(executionMatch[1], env);
  }

  return null;
}

interface ExecutionRecord {
  id: string;
  flow_id: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

async function listExecutions(env: Env): Promise<Response> {
  await ensureExecutionsSchema(env);

  const result = await env.DB.prepare(`
    SELECT id, flow_id, status, input_json, output_json, error_message, started_at, completed_at, created_at
    FROM flow_executions
    ORDER BY created_at DESC
    LIMIT 100
  `).all<ExecutionRecord>();

  return jsonResponse({
    ok: true,
    items: (result.results || []).map(mapExecutionRecord)
  });
}

async function getExecution(executionId: string, env: Env): Promise<Response> {
  await ensureExecutionsSchema(env);

  const row = await env.DB.prepare(`
    SELECT id, flow_id, status, input_json, output_json, error_message, started_at, completed_at, created_at
    FROM flow_executions
    WHERE id = ?
    LIMIT 1
  `)
    .bind(executionId)
    .first<ExecutionRecord>();

  if (!row) {
    return jsonResponse(
      {
        ok: false,
        error: "execution_not_found",
        message: "Execution not found"
      },
      { status: 404 }
    );
  }

  return jsonResponse({
    ok: true,
    item: mapExecutionRecord(row)
  });
}

async function runFlow(flowId: string, request: Request, env: Env): Promise<Response> {
  await ensureExecutionsSchema(env);

  const input = await readJson<Record<string, unknown>>(request);
  const result = await runFlowById(flowId, input, env);

  return jsonResponse(result, {
    status: result.ok ? 201 : 400
  });
}

async function ensureExecutionsSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_executions (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
}

function mapExecutionRecord(row: ExecutionRecord) {
  return {
    id: row.id,
    flowId: row.flow_id,
    status: row.status,
    input: safeParseJson(row.input_json),
    output: safeParseJson(row.output_json),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {} as T;
  }
  return (await request.json()) as T;
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
  headers.set("access-control-allow-headers", "content-type, authorization, x-internal-api-key");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}
