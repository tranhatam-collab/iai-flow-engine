/* =========================================================
IAI FLOW ENGINE
Flow Drafts API
Builder save draft / load draft / delete draft
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import {
  validateWorkflowDefinition,
  type WorkflowValidatorDefinition
} from "../flow/workflow-validator";

interface FlowDraftRow {
  id: string;
  flow_id: string | null;
  name: string;
  draft_json: string;
  validation_json: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function flowDraftsAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/flow-drafts" && method === "GET") {
    return listDrafts(request, env);
  }

  if (pathname === "/api/flow-drafts" && method === "POST") {
    return createDraft(request, env);
  }

  const match = pathname.match(/^\/api\/flow-drafts\/([^/]+)$/);
  if (match && method === "GET") {
    return getDraft(match[1], request, env);
  }

  if (match && method === "PUT") {
    return updateDraft(match[1], request, env);
  }

  if (match && method === "DELETE") {
    return deleteDraft(match[1], request, env);
  }

  return null;
}

async function listDrafts(
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureDraftsSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      name,
      draft_json,
      validation_json,
      created_by,
      created_at,
      updated_at
    FROM flow_drafts
    WHERE created_by = ?
    ORDER BY updated_at DESC
  `)
    .bind(identity.userId)
    .all<FlowDraftRow>();

  const items = (result.results || []).map((row) => ({
    id: row.id,
    flowId: row.flow_id,
    name: row.name,
    draft: safeParseJson(row.draft_json),
    validation: row.validation_json ? safeParseJson(row.validation_json) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return jsonResponse({
    ok: true,
    items
  });
}

async function getDraft(
  draftId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureDraftsSchema(env);

  const row = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      name,
      draft_json,
      validation_json,
      created_by,
      created_at,
      updated_at
    FROM flow_drafts
    WHERE id = ?
    LIMIT 1
  `)
    .bind(draftId)
    .first<FlowDraftRow>();

  if (!row) {
    return jsonResponse(
      {
        ok: false,
        error: "draft_not_found",
        message: "Flow draft not found"
      },
      { status: 404 }
    );
  }

  if (row.created_by !== identity.userId) {
    return jsonResponse(
      {
        ok: false,
        error: "draft_forbidden",
        message: "Draft does not belong to current user"
      },
      { status: 403 }
    );
  }

  return jsonResponse({
    ok: true,
    item: {
      id: row.id,
      flowId: row.flow_id,
      name: row.name,
      draft: safeParseJson(row.draft_json),
      validation: row.validation_json ? safeParseJson(row.validation_json) : null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  });
}

async function createDraft(
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureDraftsSchema(env);

  const body = await readJson<Record<string, unknown>>(request);
  const name = sanitizeText(body.name, "Untitled Draft");
  const flowId = typeof body.flowId === "string" && body.flowId.trim()
    ? body.flowId.trim()
    : null;

  const draft = normalizeDraft(body.draft, name);
  const validation = validateWorkflowDefinition(draft, identity.role);
  const now = new Date().toISOString();
  const draftId = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO flow_drafts (
      id,
      flow_id,
      name,
      draft_json,
      validation_json,
      created_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      draftId,
      flowId,
      name,
      JSON.stringify(draft),
      JSON.stringify(validation),
      identity.userId,
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.draft_created",
      resourceType: "flow_draft",
      resourceId: draftId,
      metadata: {
        flowId,
        name
      }
    },
    env
  );

  return jsonResponse(
    {
      ok: true,
      item: {
        id: draftId,
        flowId,
        name,
        draft,
        validation,
        createdBy: identity.userId,
        createdAt: now,
        updatedAt: now
      }
    },
    { status: 201 }
  );
}

async function updateDraft(
  draftId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureDraftsSchema(env);

  const existing = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      name,
      draft_json,
      validation_json,
      created_by,
      created_at,
      updated_at
    FROM flow_drafts
    WHERE id = ?
    LIMIT 1
  `)
    .bind(draftId)
    .first<FlowDraftRow>();

  if (!existing) {
    return jsonResponse(
      {
        ok: false,
        error: "draft_not_found",
        message: "Flow draft not found"
      },
      { status: 404 }
    );
  }

  if (existing.created_by !== identity.userId) {
    return jsonResponse(
      {
        ok: false,
        error: "draft_forbidden",
        message: "Draft does not belong to current user"
      },
      { status: 403 }
    );
  }

  const body = await readJson<Record<string, unknown>>(request);
  const name = sanitizeText(body.name, existing.name);
  const flowId = typeof body.flowId === "string" && body.flowId.trim()
    ? body.flowId.trim()
    : existing.flow_id;

  const draft = normalizeDraft(body.draft, name);
  const validation = validateWorkflowDefinition(draft, identity.role);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE flow_drafts
    SET
      flow_id = ?,
      name = ?,
      draft_json = ?,
      validation_json = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      flowId,
      name,
      JSON.stringify(draft),
      JSON.stringify(validation),
      now,
      draftId
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.draft_updated",
      resourceType: "flow_draft",
      resourceId: draftId,
      metadata: {
        flowId,
        name
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      id: draftId,
      flowId,
      name,
      draft,
      validation,
      updatedAt: now
    }
  });
}

async function deleteDraft(
  draftId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensureDraftsSchema(env);

  const existing = await env.DB.prepare(`
    SELECT
      id,
      created_by
    FROM flow_drafts
    WHERE id = ?
    LIMIT 1
  `)
    .bind(draftId)
    .first<{ id: string; created_by: string }>();

  if (!existing) {
    return jsonResponse(
      {
        ok: false,
        error: "draft_not_found",
        message: "Flow draft not found"
      },
      { status: 404 }
    );
  }

  if (existing.created_by !== identity.userId) {
    return jsonResponse(
      {
        ok: false,
        error: "draft_forbidden",
        message: "Draft does not belong to current user"
      },
      { status: 403 }
    );
  }

  await env.DB.prepare(`
    DELETE FROM flow_drafts
    WHERE id = ?
  `)
    .bind(draftId)
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.draft_deleted",
      resourceType: "flow_draft",
      resourceId: draftId,
      metadata: {}
    },
    env
  );

  return jsonResponse({
    ok: true,
    deleted: true,
    id: draftId
  });
}

async function ensureDraftsSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_drafts (
      id TEXT PRIMARY KEY,
      flow_id TEXT,
      name TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      validation_json TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_drafts_created_by
    ON flow_drafts (created_by, updated_at DESC)
  `).run();
}

function normalizeDraft(
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

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {} as T;
  }
  return (await request.json()) as T;
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
