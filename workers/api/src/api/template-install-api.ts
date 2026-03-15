/* =========================================================
IAI FLOW ENGINE
Template Install API
Installs a global flow template into current workspace
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { writeAuditLog } from "../security/audit";
import { validateWorkflowDefinition } from "../flow/workflow-validator";
import { ensureWorkspaceFlowSchema } from "../flow/workspace-flow-scope";

interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  stable: boolean;
  tags: string[];
  definition: Record<string, unknown>;
}

const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: "support-intake",
    name: "Support Intake",
    description: "Basic support intake workflow with trigger, set and log.",
    category: "support",
    stable: true,
    tags: ["support", "starter", "intake"],
    definition: {
      name: "Support Intake",
      entry: "trigger_1",
      nodes: [
        { id: "trigger_1", type: "trigger" },
        { id: "set_1", type: "set", config: { value: { channel: "support", priority: "normal" } } },
        { id: "log_1", type: "log" }
      ],
      edges: [
        ["trigger_1", "set_1"],
        ["set_1", "log_1"]
      ]
    }
  },
  {
    id: "webhook-to-log",
    name: "Webhook To Log",
    description: "Receives webhook payload and writes it into execution logs.",
    category: "integration",
    stable: true,
    tags: ["webhook", "debug", "logging"],
    definition: {
      name: "Webhook To Log",
      entry: "trigger_1",
      nodes: [
        { id: "trigger_1", type: "trigger" },
        { id: "log_1", type: "log" }
      ],
      edges: [
        ["trigger_1", "log_1"]
      ]
    }
  }
];

export async function templateInstallAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  const match = pathname.match(/^\/api\/flow-templates\/([^/]+)\/install$/);
  if (match && method === "POST") {
    return installTemplate(match[1], request, env);
  }

  return null;
}

async function installTemplate(
  templateId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.create");

  await ensureWorkspaceFlowSchema(env);

  const template = FLOW_TEMPLATES.find((item) => item.id === templateId);

  if (!template) {
    return jsonResponse(
      {
        ok: false,
        error: "template_not_found",
        message: "Flow template not found"
      },
      { status: 404 }
    );
  }

  const body = await readJson<Record<string, unknown>>(request);
  const customName =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : template.name;

  const definition = {
    ...template.definition,
    name: customName
  };

  const validation = validateWorkflowDefinition(
    definition as any,
    identity.role
  );

  if (!validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: "template_validation_failed",
        message: "Template cannot be installed because validation failed",
        validation
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const flowId = crypto.randomUUID();

  const storedDefinition = {
    ...definition,
    id: flowId,
    name: customName
  };

  await env.DB.prepare(`
    INSERT INTO flows (
      id,
      workspace_id,
      created_by,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      flowId,
      identity.workspaceId,
      identity.userId,
      customName,
      "draft",
      1,
      JSON.stringify(storedDefinition),
      now,
      now
    )
    .run();

  await writeAuditLog(
    identity,
    {
      eventType: "flow.template_installed",
      resourceType: "flow",
      resourceId: flowId,
      metadata: {
        templateId,
        templateName: template.name,
        installedAs: customName
      }
    },
    env
  );

  return jsonResponse(
    {
      ok: true,
      item: {
        id: flowId,
        workspaceId: identity.workspaceId,
        createdBy: identity.userId,
        name: customName,
        status: "draft",
        version: 1,
        templateId,
        definition: storedDefinition,
        validation,
        createdAt: now,
        updatedAt: now
      }
    },
    { status: 201 }
  );
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
