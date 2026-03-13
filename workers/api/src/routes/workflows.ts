import { badRequest, json, methodNotAllowed, notFound, serverError } from "../lib/json";
import { Env, WorkflowRecord, createId, nowIso, parseJson } from "../lib/db";

type WorkflowPayload = {
  id?: string;
  name?: string;
  description?: string;
  status?: "draft" | "active" | "archived";
  definition?: unknown;
};

export async function handleWorkflows(
  request: Request,
  env: Env,
  pathParts: string[],
): Promise<Response> {
  try {
    if (request.method === "GET" && pathParts.length === 0) {
      return await listWorkflows(env);
    }

    if (request.method === "POST" && pathParts.length === 0) {
      return await createWorkflow(request, env);
    }

    if (pathParts.length === 1) {
      const workflowId = pathParts[0];

      if (request.method === "GET") {
        return await getWorkflow(env, workflowId);
      }

      if (request.method === "PUT") {
        return await updateWorkflow(request, env, workflowId);
      }

      if (request.method === "DELETE") {
        return await deleteWorkflow(env, workflowId);
      }
    }

    return methodNotAllowed("Unsupported workflows route");
  } catch (error) {
    return serverError("Workflow route failed", String(error));
  }
}

async function listWorkflows(env: Env): Promise<Response> {
  const cacheKey = "workflows:list:v1";
  const cached = await env.CACHE.get(cacheKey, "json");

  if (cached) {
    return json({
      ok: true,
      cached: true,
      items: cached,
    });
  }

  const result = await env.DB.prepare(`
    SELECT id, name, description, status, version, created_at, updated_at
    FROM workflow_definitions
    ORDER BY updated_at DESC
  `).all<WorkflowRecord>();

  const items = (result.results ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.status,
    version: item.version,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));

  await env.CACHE.put(cacheKey, JSON.stringify(items), { expirationTtl: 60 });

  return json({
    ok: true,
    cached: false,
    items,
  });
}

async function getWorkflow(env: Env, workflowId: string): Promise<Response> {
  const cacheKey = `workflow:${workflowId}:full`;
  const cached = await env.CACHE.get(cacheKey, "json");

  if (cached) {
    return json({
      ok: true,
      cached: true,
      item: cached,
    });
  }

  const item = await env.DB.prepare(`
    SELECT *
    FROM workflow_definitions
    WHERE id = ?
    LIMIT 1
  `)
    .bind(workflowId)
    .first<WorkflowRecord>();

  if (!item) {
    return notFound("Workflow not found");
  }

  const normalized = {
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.status,
    version: item.version,
    definition: parseJson(item.definition_json, {}),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };

  await env.CACHE.put(cacheKey, JSON.stringify(normalized), { expirationTtl: 300 });

  return json({
    ok: true,
    cached: false,
    item: normalized,
  });
}

async function createWorkflow(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as WorkflowPayload;

  if (!body.name || !body.definition) {
    return badRequest("name and definition are required");
  }

  const workflowId = body.id || createId("wf");
  const timestamp = nowIso();

  await env.DB.prepare(`
    INSERT INTO workflow_definitions (
      id, name, description, status, version, definition_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      workflowId,
      body.name,
      body.description || "",
      body.status || "draft",
      1,
      JSON.stringify(body.definition),
      timestamp,
      timestamp,
    )
    .run();

  await invalidateWorkflowCaches(env, workflowId);

  return json(
    {
      ok: true,
      id: workflowId,
      message: "Workflow created",
    },
    { status: 201 },
  );
}

async function updateWorkflow(request: Request, env: Env, workflowId: string): Promise<Response> {
  const body = (await request.json()) as WorkflowPayload;

  const existing = await env.DB.prepare(`
    SELECT version
    FROM workflow_definitions
    WHERE id = ?
    LIMIT 1
  `)
    .bind(workflowId)
    .first<{ version: number }>();

  if (!existing) {
    return notFound("Workflow not found");
  }

  const timestamp = nowIso();

  await env.DB.prepare(`
    UPDATE workflow_definitions
    SET
      name = ?,
      description = ?,
      status = ?,
      version = ?,
      definition_json = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      body.name || "Untitled Workflow",
      body.description || "",
      body.status || "draft",
      Number(existing.version) + 1,
      JSON.stringify(body.definition ?? {}),
      timestamp,
      workflowId,
    )
    .run();

  await invalidateWorkflowCaches(env, workflowId);

  return json({
    ok: true,
    id: workflowId,
    message: "Workflow updated",
  });
}

async function deleteWorkflow(env: Env, workflowId: string): Promise<Response> {
  await env.DB.prepare(`
    DELETE FROM workflow_definitions
    WHERE id = ?
  `)
    .bind(workflowId)
    .run();

  await invalidateWorkflowCaches(env, workflowId);

  return json({
    ok: true,
    id: workflowId,
    message: "Workflow deleted",
  });
}

async function invalidateWorkflowCaches(env: Env, workflowId: string): Promise<void> {
  await Promise.all([
    env.CACHE.delete("workflows:list:v1"),
    env.CACHE.delete(`workflow:${workflowId}:full`),
  ]);
}