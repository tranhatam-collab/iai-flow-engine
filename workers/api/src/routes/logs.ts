import { badRequest, json, methodNotAllowed, serverError } from "../lib/json";
import { Env, LogRecord, createId, nowIso, parseJson } from "../lib/db";

type LogCreatePayload = {
  runId?: string;
  level?: "info" | "success" | "error";
  message?: string;
  meta?: unknown;
};

export async function handleLogs(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  try {
    if (request.method === "GET" && pathParts.length === 0) {
      return await listLogs(env);
    }

    if (request.method === "POST" && pathParts.length === 0) {
      return await createLog(request, env);
    }

    if (request.method === "GET" && pathParts.length === 1) {
      return await getLogsByRunId(env, pathParts[0]);
    }

    return methodNotAllowed("Unsupported logs route");
  } catch (error) {
    return serverError("Logs route failed", String(error));
  }
}

async function listLogs(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT *
    FROM execution_logs
    ORDER BY created_at DESC
    LIMIT 100
  `).all<LogRecord>();

  return json({
    ok: true,
    items: (result.results ?? []).map((item) => ({
      id: item.id,
      runId: item.run_id,
      level: item.level,
      message: item.message,
      meta: parseJson(item.meta_json, null),
      createdAt: item.created_at,
    })),
  });
}

async function getLogsByRunId(env: Env, runId: string): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT *
    FROM execution_logs
    WHERE run_id = ?
    ORDER BY created_at DESC
  `)
    .bind(runId)
    .all<LogRecord>();

  return json({
    ok: true,
    items: (result.results ?? []).map((item) => ({
      id: item.id,
      runId: item.run_id,
      level: item.level,
      message: item.message,
      meta: parseJson(item.meta_json, null),
      createdAt: item.created_at,
    })),
  });
}

async function createLog(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as LogCreatePayload;

  if (!body.runId || !body.message) {
    return badRequest("runId and message are required");
  }

  const logId = createId("log");

  await env.DB.prepare(`
    INSERT INTO execution_logs (
      id, run_id, level, message, meta_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(
      logId,
      body.runId,
      body.level || "info",
      body.message,
      body.meta ? JSON.stringify(body.meta) : null,
      nowIso(),
    )
    .run();

  return json(
    {
      ok: true,
      id: logId,
      message: "Log created",
    },
    { status: 201 },
  );
}