import { badRequest, json, methodNotAllowed, notFound, serverError } from "../lib/json";
import {
  Env,
  RunRecord,
  bumpMetric,
  createId,
  nowIso,
  parseJson,
  setMetric,
} from "../lib/db";

type RunCreatePayload = {
  workflowId?: string | null;
  workflowName?: string;
  nodeCount?: number;
  edgeCount?: number;
};

type RunUpdatePayload = {
  status?: "queued" | "running" | "success" | "failed";
  result?: unknown;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export async function handleRuns(request: Request, env: Env, pathParts: string[]): Promise<Response> {
  try {
    if (request.method === "GET" && pathParts.length === 0) {
      return await listRuns(env);
    }

    if (request.method === "POST" && pathParts.length === 0) {
      return await createRun(request, env);
    }

    if (pathParts.length === 1) {
      const runId = pathParts[0];

      if (request.method === "GET") {
        return await getRun(env, runId);
      }

      if (request.method === "PUT") {
        return await updateRun(request, env, runId);
      }
    }

    return methodNotAllowed("Unsupported runs route");
  } catch (error) {
    return serverError("Run route failed", String(error));
  }
}

async function listRuns(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT *
    FROM execution_runs
    ORDER BY created_at DESC
    LIMIT 50
  `).all<RunRecord>();

  const items = (result.results ?? []).map((item) => ({
    id: item.id,
    workflowId: item.workflow_id,
    workflowName: item.workflow_name,
    status: item.status,
    nodeCount: item.node_count,
    edgeCount: item.edge_count,
    result: parseJson(item.result_json, null),
    error: item.error_text,
    startedAt: item.started_at,
    finishedAt: item.finished_at,
    createdAt: item.created_at,
  }));

  return json({
    ok: true,
    items,
  });
}

async function getRun(env: Env, runId: string): Promise<Response> {
  const item = await env.DB.prepare(`
    SELECT *
    FROM execution_runs
    WHERE id = ?
    LIMIT 1
  `)
    .bind(runId)
    .first<RunRecord>();

  if (!item) {
    return notFound("Run not found");
  }

  return json({
    ok: true,
    item: {
      id: item.id,
      workflowId: item.workflow_id,
      workflowName: item.workflow_name,
      status: item.status,
      nodeCount: item.node_count,
      edgeCount: item.edge_count,
      result: parseJson(item.result_json, null),
      error: item.error_text,
      startedAt: item.started_at,
      finishedAt: item.finished_at,
      createdAt: item.created_at,
    },
  });
}

async function createRun(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as RunCreatePayload;

  if (!body.workflowName) {
    return badRequest("workflowName is required");
  }

  const runId = createId("run");
  const timestamp = nowIso();

  await env.DB.prepare(`
    INSERT INTO execution_runs (
      id, workflow_id, workflow_name, status, node_count, edge_count, result_json, error_text,
      started_at, finished_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      runId,
      body.workflowId || null,
      body.workflowName,
      "queued",
      body.nodeCount || 0,
      body.edgeCount || 0,
      null,
      null,
      null,
      null,
      timestamp,
    )
    .run();

  const coordinatorId = env.EXECUTION_COORDINATOR.idFromName(runId);
  const stub = env.EXECUTION_COORDINATOR.get(coordinatorId);

  await stub.fetch("https://execution-coordinator/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId,
      workflowId: body.workflowId || null,
      workflowName: body.workflowName,
    }),
  });

  return json(
    {
      ok: true,
      id: runId,
      message: "Run created",
    },
    { status: 201 },
  );
}

async function updateRun(request: Request, env: Env, runId: string): Promise<Response> {
  const body = (await request.json()) as RunUpdatePayload;
  const existing = await env.DB.prepare(`
    SELECT status
    FROM execution_runs
    WHERE id = ?
    LIMIT 1
  `)
    .bind(runId)
    .first<{ status: string }>();

  if (!existing) {
    return notFound("Run not found");
  }

  await env.DB.prepare(`
    UPDATE execution_runs
    SET
      status = ?,
      result_json = ?,
      error_text = ?,
      started_at = ?,
      finished_at = ?
    WHERE id = ?
  `)
    .bind(
      body.status || existing.status,
      body.result !== undefined ? JSON.stringify(body.result) : null,
      body.error || null,
      body.startedAt || null,
      body.finishedAt || null,
      runId,
    )
    .run();

  if (body.status === "success" || body.status === "failed") {
    await bumpMetric(env, "total_runs", 1);
    await setMetric(env, "last_run_at", nowIso());

    if (body.status === "success") {
      await bumpMetric(env, "success_runs", 1);
    }

    if (body.status === "failed") {
      await bumpMetric(env, "failed_runs", 1);
    }
  }

  return json({
    ok: true,
    id: runId,
    message: "Run updated",
  });
}