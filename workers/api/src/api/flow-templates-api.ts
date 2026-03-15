/* =========================================================
IAI FLOW ENGINE
Flow Templates API
Production-ready starter templates for builder/frontend
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";

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
  },
  {
    id: "conditional-routing",
    name: "Conditional Routing",
    description: "Branches payload based on a single condition.",
    category: "logic",
    stable: true,
    tags: ["if", "branch", "routing"],
    definition: {
      name: "Conditional Routing",
      entry: "trigger_1",
      nodes: [
        { id: "trigger_1", type: "trigger" },
        { id: "if_1", type: "if", config: { key: "priority", value: "high" } },
        { id: "set_true", type: "set", config: { value: { route: "urgent" } } },
        { id: "set_false", type: "set", config: { value: { route: "standard" } } },
        { id: "log_1", type: "log" }
      ],
      edges: [
        ["trigger_1", "if_1"],
        ["if_1", "set_true", "true"],
        ["if_1", "set_false", "false"],
        ["set_true", "log_1"],
        ["set_false", "log_1"]
      ]
    }
  },
  {
    id: "runtime-inspect",
    name: "Runtime Inspect",
    description: "Inspects runtime metadata and emits runtime output.",
    category: "runtime",
    stable: false,
    tags: ["runtime", "inspect", "diagnostics"],
    definition: {
      name: "Runtime Inspect",
      entry: "trigger_1",
      nodes: [
        { id: "trigger_1", type: "trigger" },
        { id: "runtime_1", type: "runtime", config: { action: "inspect" } },
        { id: "log_1", type: "log" }
      ],
      edges: [
        ["trigger_1", "runtime_1"],
        ["runtime_1", "log_1"]
      ]
    }
  }
];

export async function flowTemplatesAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/flow-templates" && method === "GET") {
    return listTemplates(request, env, url);
  }

  const match = pathname.match(/^\/api\/flow-templates\/([^/]+)$/);
  if (match && method === "GET") {
    return getTemplate(match[1], request, env);
  }

  return null;
}

async function listTemplates(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  const category = (url.searchParams.get("category") || "").trim().toLowerCase();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const stableOnly = url.searchParams.get("stable") === "true";

  let items = [...FLOW_TEMPLATES];

  if (category) {
    items = items.filter((item) => item.category === category);
  }

  if (stableOnly) {
    items = items.filter((item) => item.stable);
  }

  if (q) {
    items = items.filter((item) => {
      return (
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }

  return jsonResponse({
    ok: true,
    items,
    filters: {
      category: category || null,
      q: q || null,
      stable: stableOnly
    }
  });
}

async function getTemplate(
  templateId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  const item = FLOW_TEMPLATES.find((template) => template.id === templateId);

  if (!item) {
    return jsonResponse(
      {
        ok: false,
        error: "template_not_found",
        message: "Flow template not found"
      },
      { status: 404 }
    );
  }

  return jsonResponse({
    ok: true,
    item
  });
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
