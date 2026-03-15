/* =========================================================
IAI FLOW ENGINE
Flow Builder API
Workspace-scoped builder facade for editor UI
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import { validateWorkflowDefinition } from "../flow/workflow-validator";
import { runWorkflow } from "../flow/workflow-runtime";
import {
  ensureWorkspaceFlowSchema,
  getScopedFlow
} from "../flow/workspace-flow-scope";

export async function flowBuilderAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const stateMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)$/);
  if (stateMatch && method === "GET") {
    return getBuilderState(stateMatch[1], request, env);
  }

  if (stateMatch && method === "PUT") {
    return saveBuilderState(stateMatch[1], request, env);
  }

  const validateMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/validate$/);
  if (validateMatch && method === "POST") {
    return validateBuilderFlow(validateMatch[1], request, env);
  }

  const previewMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/preview$/);
  if (previewMatch && method === "POST") {
    return previewBuilderFlow(previewMatch[1], request, env);
  }

  const publishMatch = pathname.match(/^\/api\/builder\/flows\/([^/]+)\/publish$/);
  if (publishMatch && method === "POST") {
    return publishBuilderFlow(publishMatch[1], request, env);
  }

  return null;
}

/* =========================================================
GET BUILDER STATE
========================================================= */

async function getBuilderState(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureBuilderSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  const builderState = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      workspace_id,
      canvas_json,
      settings_json,
      last_validation_json,
      updated_by,
      created_at,
      updated_at
    FROM flow_builder_states
    WHERE flow_id = ? AND workspace_id = ?
    LIMIT 1
  `)
    .bind(flowId, identity.workspaceId)
    .first<any>();

  const definition = safeParseJson(flow.definition_json);

  return jsonResponse({
    ok: true,
    item: {
      flow: {
        id: flow.id,
        workspaceId: flow.workspace_id,
        createdBy: flow.created_by,
        name: flow.name,
        status: flow.status,
        version: flow.version,
        definition,
        createdAt: flow.created_at,
        updatedAt: flow.updated_at
      },
      builder: builderState
        ? {
            id: builderState.id,
            flowId: builderState.flow_id,
            workspaceId: builderState.workspace_id,
            canvas: safeParseJson(builderState.canvas_json),
            settings: safeParseJson(builderState.settings_json),
            lastValidation: safeParseJson(builderState.last_validation_json),
            updatedBy: builderState.updated_by,
            createdAt: builderState.created_at,
            updatedAt: builderState.updated_at
          }
        : null
    }
  });
}

/* =========================================================
SAVE BUILDER STATE
========================================================= */

async function saveBuilderState(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureBuilderSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  const body = await readJson<Record<string, unknown>>(request);
  const canvas = isRecord(body.canvas) ? body.canvas : {};
  const settings = isRecord(body.settings) ? body.settings : {};
  const definition = normalizeDefinition(body.definition, flow.name);

  const validation = validateWorkflowDefinition(definition, identity.role);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(`
    SELECT id
    FROM flow_builder_states
    WHERE flow_id = ? AND workspace_id = ?
    LIMIT 1
  `)
    .bind(flowId, identity.workspaceId)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(`
      UPDATE flow_builder_states
      SET
        canvas_json = ?,
        settings_json = ?,
        last_validation_json = ?,
        updated_by = ?,
        updated_at = ?
      WHERE id = ?
    `)
      .bind(
        JSON.stringify(canvas),
        JSON.stringify(settings),
        JSON.stringify(validation),
        identity.userId,
        now,
        existing.id
      )
      .run();
  } else {
    await env.DB.prepare(`
      INSERT INTO flow_builder_states (
        id,
        flow_id,
        workspace_id,
        canvas_json,
        settings_json,
        last_validation_json,
        updated_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        flowId,
        identity.workspaceId,
        JSON.stringify(canvas),
        JSON.stringify(settings),
        JSON.stringify(validation),
        identity.userId,
        now,
        now
      )
      .run();
  }

  await writeAuditLog(
    identity,
    {
      eventType: "flow.builder_saved",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        validationOk: validation.ok
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      flowId,
      workspaceId: identity.workspaceId,
      canvas,
      settings,
      validation,
      updatedAt: now
    }
  });
}

/* =========================================================
VALIDATE BUILDER FLOW
========================================================= */

async function validateBuilderFlow(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  const body = await readJson<Record<string, unknown>>(request);
  const definition = normalizeDefinition(
    body.definition ?? safeParseJson(flow.definition_json),
    flow.name
  );

  const validation = validateWorkflowDefinition(definition, identity.role);

  return jsonResponse({
    ok: validation.ok,
    validation
  }, { status: validation.ok ? 200 : 400 });
}

/* =========================================================
PREVIEW BUILDER FLOW
========================================================= */

async function previewBuilderFlow(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.run");

  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  const body = await readJson<Record<string, unknown>>(request);
  const definition = normalizeDefinition(
    body.definition ?? safeParseJson(flow.definition_json),
    flow.name
  );
  const input = isRecord(body.input) ? body.input : {};

  const validation = validateWorkflowDefinition(definition, identity.role);

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
        validation
      },
      { status: 400 }
    );
  }

  const executionId = crypto.randomUUID();

  const preview = await runWorkflow({
    workflow: {
      ...definition,
      id: flow.id,
      name: definition.name || flow.name
    },
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    executionId,
    input,
    env: {
      mode: "builder-preview",
      appName: env.APP_NAME,
      environment: env.ENVIRONMENT
    }
  });

  await writeAuditLog(
    identity,
    {
      eventType: "flow.builder_previewed",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        previewExecutionId: executionId,
        previewStatus: preview.status
      }
    },
    env
  );

  return jsonResponse({
    ok: preview.success,
    mode: "preview",
    item: preview
  }, { status: preview.success ? 200 : 400 });
}

/* =========================================================
PUBLISH BUILDER FLOW
========================================================= */

async function publishBuilderFlow(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureBuilderSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return errorResponse("flow_not_found", "Flow not found in current workspace", 404);
  }

  const body = await readJson<Record<string, unknown>>(request);
  const definition = normalizeDefinition(
    body.definition ?? safeParseJson(flow.definition_json),
    flow.name
  );

  const validation = validateWorkflowDefinition(definition, identity.role);

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
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
      status = 'published',
      version = ?,
      definition_json = ?,
      updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `)
    .bind(
      definition.name || flow.name,
      nextVersion,
      JSON.stringify({
        ...definition,
        id: flow.id,
        name: definition.name || flow.name
      }),
      now,
      flowId,
      identity.workspaceId
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.builder_published",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        workspaceId: identity.workspaceId,
        version: nextVersion
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      id: flowId,
      workspaceId: identity.workspaceId,
      status: "published",
      version: nextVersion,
      updatedAt: now,
      validation
    }
  });
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureBuilderSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_builder_states (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      canvas_json TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      last_validation_json TEXT,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_builder_states_workspace_flow
    ON flow_builder_states (workspace_id, flow_id, updated_at DESC)
  `).run();
}

/* =========================================================
UTILS
========================================================= */

function normalizeDefinition(
  input: unknown,
  fallbackName: string
): WorkflowValidatorDefinition {
  const base = isRecord(input) ? input : {};

  return {
    id: typeof base.id === "string" && base.id.trim() ? base.id.trim() : undefined,
    name: typeof base.name === "string" && base.name.trim() ? base.name.trim() : fallbackName,
    entry: typeof base.entry === "string" && base.entry.trim() ? base.entry.trim() : null,
    nodes: Array.isArray(base.nodes) ? base.nodes : [],
    edges: Array.isArray(base.edges) ? base.edges : []
  };
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {} as T;
  }
  return (await request.json()) as T;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeParseJson(value: string): unknown {
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
