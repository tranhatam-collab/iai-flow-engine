/* =========================================================
IAI FLOW ENGINE
Flow Import Export API
Import/export workflow JSON between builder/local/production
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

export async function flowImportExportAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const exportMatch = pathname.match(/^\/api\/flows\/([^/]+)\/export$/);
  if (exportMatch && method === "GET") {
    return exportFlow(exportMatch[1], request, env);
  }

  if (pathname === "/api/flows/import" && method === "POST") {
    return importFlow(request, env);
  }

  return null;
}

async function exportFlow(
  flowId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  const flow = await env.DB.prepare(`
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

  if (!flow) {
    return jsonResponse(
      {
        ok: false,
        error: "flow_not_found",
        message: "Flow not found"
      },
      { status: 404 }
    );
  }

  const exported = {
    exportVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      version: flow.version,
      definition: safeParseJson(flow.definition_json),
      createdAt: flow.created_at,
      updatedAt: flow.updated_at
    }
  };

  await writeAuditLog(
    identity,
    {
      eventType: "flow.exported",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        version: flow.version
      }
    },
    env
  );

  return jsonResponse({
    ok: true,
    item: exported
  });
}

async function importFlow(
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.create");

  const body = await readJson<Record<string, unknown>>(request);

  const importedFlow = isRecord(body.flow) ? body.flow : {};
  const name = sanitizeText(importedFlow.name, "Imported Flow");
  const status = sanitizeFlowStatus(importedFlow.status);
  const definition = normalizeDefinition(
    importedFlow.definition,
    name
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
        message: "Imported flow JSON is invalid",
        validation
      },
      { status: 400 }
    );
  }

  const flowId = crypto.randomUUID();
  const now = new Date().toISOString();

  const storedDefinition = {
    ...definition,
    id: flowId,
    name
  };

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
      JSON.stringify(storedDefinition),
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.imported",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        name,
        status
      }
    },
    env
  );

  return jsonResponse(
    {
      ok: true,
      item: {
        id: flowId,
        name,
        status,
        version: 1,
        definition: storedDefinition,
        validation,
        importedAt: now
      }
    },
    { status: 201 }
  );
}

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

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeFlowStatus(value: unknown): string {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    status === "draft" ||
    status === "published" ||
    status === "archived" ||
    status === "active"
  ) {
    return status;
  }

  return "draft";
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
