/* =========================================================
IAI FLOW ENGINE
Flow Publish API
Production-ready publish/unpublish flow layer
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import {
  validateWorkflowDefinition,
  type WorkflowValidatorDefinition
} from "../flow/workflow-validator";

interface FlowRow {
  id: string;
  name: string;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

export async function flowPublishAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const publishMatch = pathname.match(/^\/api\/flows\/([^/]+)\/publish$/);
  if (publishMatch && method === "POST") {
    return publishFlow(publishMatch[1], request, env);
  }

  const unpublishMatch = pathname.match(/^\/api\/flows\/([^/]+)\/unpublish$/);
  if (unpublishMatch && method === "POST") {
    return unpublishFlow(unpublishMatch[1], request, env);
  }

  return null;
}

async function publishFlow(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensurePublishSchema(env);

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
    .first<FlowRow>();

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

  const definition = normalizeDefinition(
    safeParseJson(row.definition_json),
    row.name,
    flowId
  );

  const validation = validateWorkflowDefinition(
    definition,
    identity.role
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "workflow_validation_failed",
        message: "Flow cannot be published because validation failed",
        validation
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE flows
    SET status = ?, updated_at = ?
    WHERE id = ?
  `)
    .bind("published", now, flowId)
    .run();

  await env.DB.prepare(`
    INSERT INTO flow_publications (
      id,
      flow_id,
      version,
      status,
      published_by,
      published_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      flowId,
      row.version,
      "published",
      identity.userId,
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.published",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        version: row.version,
        validation
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      id: flowId,
      status: "published",
      version: row.version,
      publishedAt: now,
      validation
    }
  });
}

async function unpublishFlow(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.update");

  await ensurePublishSchema(env);

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
    .first<FlowRow>();

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

  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE flows
    SET status = ?, updated_at = ?
    WHERE id = ?
  `)
    .bind("draft", now, flowId)
    .run();

  await env.DB.prepare(`
    INSERT INTO flow_publications (
      id,
      flow_id,
      version,
      status,
      published_by,
      published_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      flowId,
      row.version,
      "unpublished",
      identity.userId,
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.unpublished",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        version: row.version
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: {
      id: flowId,
      status: "draft",
      version: row.version,
      unpublishedAt: now
    }
  });
}

async function ensurePublishSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_publications (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_publications_flow_id
    ON flow_publications (flow_id, created_at DESC)
  `).run();
}

function normalizeDefinition(
  input: unknown,
  fallbackName: string,
  flowId: string
): WorkflowValidatorDefinition {
  const base = isRecord(input) ? input : {};

  return {
    id: typeof base.id === "string" && base.id.trim() ? base.id.trim() : flowId,
    name: typeof base.name === "string" && base.name.trim() ? base.name.trim() : fallbackName,
    entry: typeof base.entry === "string" && base.entry.trim() ? base.entry.trim() : null,
    nodes: Array.isArray(base.nodes) ? base.nodes : [],
    edges: Array.isArray(base.edges) ? base.edges : []
  };
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
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
