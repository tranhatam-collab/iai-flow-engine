/* =========================================================
IAI FLOW ENGINE
Executions API
Production-grade execution read API synced with flow-engine
and execution-log persistence
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import { getFlowExecution, listFlowEngineExecutions } from "../flow/flow-engine";

export async function executionsAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/executions" && method === "GET") {
    return listExecutions(request, env);
  }

  const executionMatch = pathname.match(/^\/api\/executions\/([^/]+)$/);
  if (executionMatch && method === "GET") {
    return getExecution(executionMatch[1], request, env);
  }

  return null;
}

/* =========================================================
LIST EXECUTIONS
========================================================= */

async function listExecutions(
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "execution.read");

  const items = await listFlowEngineExecutions(identity.workspaceId, env);

  return jsonResponse({
    ok: true,
    items
  });
}

/* =========================================================
GET EXECUTION DETAIL
========================================================= */

async function getExecution(
  executionId: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "execution.read");

  const item = await getFlowExecution(executionId, env);

  if (!item) {
    return jsonResponse(
      {
        ok: false,
        error: "execution_not_found",
        message: "Execution not found"
      },
      { status: 404 }
    );
  }

  const executionWorkspaceId =
    isRecord(item.log) && typeof item.log.workspaceId === "string"
      ? item.log.workspaceId
      : null;

  if (!executionWorkspaceId) {
    return jsonResponse(
      {
        ok: false,
        error: "execution_workspace_missing",
        message: "Execution workspace metadata is missing"
      },
      { status: 500 }
    );
  }

  if (executionWorkspaceId !== identity.workspaceId) {
    return jsonResponse(
      {
        ok: false,
        error: "execution_forbidden",
        message: "Execution does not belong to current workspace"
      },
      { status: 403 }
    );
  }

  return jsonResponse({
    ok: true,
    item
  });
}

/* =========================================================
UTILS
========================================================= */

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
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
