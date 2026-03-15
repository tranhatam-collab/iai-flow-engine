/* =========================================================
IAI FLOW ENGINE
Flow Drafts API
Workspace scoped builder drafts
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
  getScopedFlow
} from "../flow/workspace-flow-scope";

export async function flowDraftsAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const draftsMatch = pathname.match(/^\/api\/flows\/([^/]+)\/drafts$/);

  if (draftsMatch && method === "GET") {
    return listDrafts(draftsMatch[1], request, env);
  }

  if (draftsMatch && method === "POST") {
    return saveDraft(draftsMatch[1], request, env);
  }

  const draftMatch = pathname.match(/^\/api\/flows\/([^/]+)\/drafts\/([^/]+)$/);

  if (draftMatch && method === "GET") {
    return getDraft(draftMatch[1], draftMatch[2], request, env);
  }

  if (draftMatch && method === "DELETE") {
    return deleteDraft(draftMatch[1], draftMatch[2], request, env);
  }

  const restoreMatch = pathname.match(
    /^\/api\/flows\/([^/]+)\/drafts\/([^/]+)\/restore$/
  );

  if (restoreMatch && method === "POST") {
    return restoreDraft(
      restoreMatch[1],
      restoreMatch[2],
      request,
      env
    );
  }

  return null;
}

/* =========================================================
LIST DRAFTS
========================================================= */

async function listDrafts(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {

  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  await ensureDraftSchema(env);
  await ensureWorkspaceFlowSchema(env);

  const flow = await getScopedFlow(flowId, identity.workspaceId, env);

  if (!flow) {
    return error("flow_not_found", 404);
  }

  const result = await env.DB.prepare(`
    SELECT *
    FROM flow_drafts
    WHERE flow_id = ? AND workspace_id = ?
    ORDER BY updated_at DESC
  `)
    .bind(flowId, identity.workspaceId)
    .all<any>();

  const items = (result.results || []).map((row) => ({
    id: row.id,
    flowId: row.flow_id,
    workspaceId: row.workspace_id,
    name: row.name,
    definition: safeParse(row.definition_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return json({
    ok: true,
    items
  });
}

/* =========================================================
GET DRAFT
========================================================= */

async function getDraft(
  flowId: string,
  draftId: string,
  request: Request,
  env: Env
): Promise<Response> {

  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  const row = await env.DB.prepare(`
    SELECT *
    FROM flow_drafts
    WHERE id = ? AND flow_id = ? AND workspace_id = ?
    LIMIT 1
  `)
    .bind(draftId, flowId, identity.workspaceId)
    .first<any>();

  if (!row) {
    return error("draft_not_found", 404);
  }

  return json({
    ok: true,
    item: {
      id: row.id,
      flowId: row.flow_id,
      workspaceId: row.workspace_id,
      name: row.name,
      definition: safeParse(row.definition_json),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  });
}

/* =========================================================
SAVE DRAFT
========================================================= */

async function saveDraft(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {

  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureDraftSchema(env);

  const body = await request.json<any>();

  const name = sanitize(body.name, "Draft");
  const definition = normalizeDefinition(body.definition, name);

  const validation = validateWorkflowDefinition(
    definition,
    identity.role
  );

  if (!validation.ok) {
    return json({
      ok: false,
      error: "workflow_validation_failed",
      validation
    }, 400);
  }

  const draftId = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO flow_drafts (
      id,
      flow_id,
      workspace_id,
      name,
      definition_json,
      created_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      draftId,
      flowId,
      identity.workspaceId,
      name,
      JSON.stringify(definition),
      identity.userId,
      now,
      now
    )
    .run();

  await writeAuditLog(identity, {
    eventType: "flow.draft_saved",
    resourceType: "flow",
    resourceId: flowId,
    metadata: {
      workspaceId: identity.workspaceId,
      draftId
    }
  }, env);

  return json({
    ok: true,
    item: {
      id: draftId,
      flowId,
      workspaceId: identity.workspaceId,
      name,
      definition,
      createdAt: now,
      updatedAt: now
    }
  }, 201);
}

/* =========================================================
DELETE DRAFT
========================================================= */

async function deleteDraft(
  flowId: string,
  draftId: string,
  request: Request,
  env: Env
): Promise<Response> {

  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  const result = await env.DB.prepare(`
    DELETE FROM flow_drafts
    WHERE id = ? AND flow_id = ? AND workspace_id = ?
  `)
    .bind(draftId, flowId, identity.workspaceId)
    .run();

  if (!result.success) {
    return error("delete_failed", 500);
  }

  return json({
    ok: true,
    deleted: true
  });
}

/* =========================================================
RESTORE DRAFT
========================================================= */

async function restoreDraft(
  flowId: string,
  draftId: string,
  request: Request,
  env: Env
): Promise<Response> {

  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  const draft = await env.DB.prepare(`
    SELECT *
    FROM flow_drafts
    WHERE id = ? AND flow_id = ? AND workspace_id = ?
  `)
    .bind(draftId, flowId, identity.workspaceId)
    .first<any>();

  if (!draft) {
    return error("draft_not_found", 404);
  }

  const definition = safeParse(draft.definition_json);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE flows
    SET
      definition_json = ?,
      updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `)
    .bind(
      JSON.stringify(definition),
      now,
      flowId,
      identity.workspaceId
    )
    .run();

  await writeAuditLog(identity, {
    eventType: "flow.draft_restored",
    resourceType: "flow",
    resourceId: flowId,
    metadata: {
      draftId,
      workspaceId: identity.workspaceId
    }
  }, env);

  return json({
    ok: true,
    restored: true
  });
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureDraftSchema(env: Env) {

  await env.DB.prepare(`
  CREATE TABLE IF NOT EXISTS flow_drafts (
    id TEXT PRIMARY KEY,
    flow_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT,
    definition_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  `).run();

}

/* =========================================================
UTIL
========================================================= */

function normalizeDefinition(input: any, name: string): WorkflowValidatorDefinition {

  const base = typeof input === "object" && input ? input : {};

  return {
    id: base.id,
    name: base.name || name,
    entry: base.entry || null,
    nodes: Array.isArray(base.nodes) ? base.nodes : [],
    edges: Array.isArray(base.edges) ? base.edges : []
  };
}

function sanitize(v: any, fallback: string) {
  if (typeof v === "string" && v.trim()) return v.trim();
  return fallback;
}

function safeParse(v: string) {
  try { return JSON.parse(v); }
  catch { return null; }
}

function normalizePath(p: string) {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0,-1);
  return p;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers:{
      "content-type":"application/json",
      "access-control-allow-origin":"*"
    }
  });
}

function error(code: string, status: number) {
  return json({
    ok:false,
    error:code
  }, status);
}
