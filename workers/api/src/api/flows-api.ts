import type { Env } from "../index";

export async function flowsAPI(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/flows" && method === "GET") {
    return listFlows(env);
  }

  if (pathname === "/api/flows" && method === "POST") {
    return createFlow(request, env);
  }

  const flowMatch = pathname.match(/^\/api\/flows\/([^/]+)$/);
  if (flowMatch && method === "GET") {
    return getFlow(flowMatch[1], env);
  }

  if (flowMatch && method === "PUT") {
    return updateFlow(flowMatch[1], request, env);
  }

  if (flowMatch && method === "DELETE") {
    return deleteFlow(flowMatch[1], env);
  }

  return null;
}

interface FlowRecord {
  id: string;
  name: string;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

interface CreateFlowBody {
  name?: string;
  status?: string;
  definition?: unknown;
}

async function listFlows(env: Env): Promise<Response> {
  await ensureFlowsSchema(env);

  const result = await env.DB.prepare(`
    SELECT id, name, status, version, definition_json, created_at, updated_at
    FROM flows
    ORDER BY updated_at DESC
  `).all<FlowRecord>();

  const flows = (result.results || []).map((row) => ({
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
    items: flows
  });
}

async function getFlow(flowId: string, env: Env): Promise<Response> {
  await ensureFlowsSchema(env);

  const result = await env.DB.prepare(`
    SELECT id, name, status, version, definition_json, created_at, updated_at
    FROM flows
    WHERE id = ?
    LIMIT 1
  `)
    .bind(flowId)
    .first<FlowRecord>();

  if (!result) {
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
      id: result.id,
      name: result.name,
      status: result.status,
      version: result.version,
      definition: safeParseJson(result.definition_json),
      createdAt: result.created_at,
      updatedAt: result.updated_at
    }
  });
}

async function createFlow(request: Request, env: Env): Promise<Response> {
  await ensureFlowsSchema(env);

  const body = await readJson<CreateFlowBody>(request);
  const now = new Date().toISOString();
  const flowId = crypto.randomUUID();
  const name = sanitizeText(body.name, "Untitled Flow");
  const status = sanitizeStatus(body.status);
  const definition = normalizeDefinition(body.definition, name);

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
      JSON.stringify(definition),
      now,
      now
    )
    .run();

  return jsonResponse(
    {
      ok: true,
      item: {
        id: flowId,
        name,
        status,
        version: 1,
        definition,
        createdAt: now,
        updatedAt: now
      }
    },
    { status: 201 }
  );
}

async function updateFlow(flowId: string, request: Request, env: Env): Promise<Response> {
  await ensureFlowsSchema(env);

  const existing = await env.DB.prepare(`
    SELECT id, name, status, version, definition_json
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

  const body = await readJson<CreateFlowBody>(request);
  const now = new Date().toISOString();
  const nextName = sanitizeText(body.name, existing.name);
  const nextStatus = sanitizeStatus(body.status || existing.status);
  const nextDefinition = normalizeDefinition(
    body.definition ?? safeParseJson(existing.definition_json),
    nextName
  );
  const nextVersion = Number(existing.version || 1) + 1;

  await env.DB.prepare(`
    UPDATE flows
    SET name = ?, status = ?, version = ?, definition_json = ?, updated_at = ?
    WHERE id = ?
  `)
    .bind(
      nextName,
      nextStatus,
      nextVersion,
      JSON.stringify(nextDefinition),
      now,
      flowId
    )
    .run();

  return jsonResponse({
    ok: true,
    item: {
      id: flowId,
      name: nextName,
      status: nextStatus,
      version: nextVersion,
      definition: nextDefinition,
      updatedAt: now
    }
  });
}

async function deleteFlow(flowId: string, env: Env): Promise<Response> {
  await ensureFlowsSchema(env);

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

  return jsonResponse({
    ok: true,
    deleted: true,
    id: flowId
  });
}

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
}

function normalizeDefinition(input: unknown, fallbackName: string): Record<string, unknown> {
  const base = isRecord(input) ? input : {};

  const nodes = Array.isArray(base.nodes) ? base.nodes : [];
  const edges = Array.isArray(base.edges) ? base.edges : [];

  return {
    name: typeof base.name === "string" && base.name.trim() ? base.name.trim() : fallbackName,
    entry: typeof base.entry === "string" && base.entry.trim() ? base.entry.trim() : null,
    nodes,
    edges
  };
}

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeStatus(value: unknown): string {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (status === "published" || status === "draft" || status === "archived") {
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
