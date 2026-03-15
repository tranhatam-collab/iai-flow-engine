import type { Env } from "./index";

import { securityAPI } from "./api/security-api";
import { flowsAPI } from "./api/flows-api";
import { flowRunsDashboardAPI } from "./api/flow-runs-dashboard-api";
import { executionsAPI } from "./api/executions-api";

import { nodeCatalogAPI } from "./api/node-catalog-api";
import { flowTemplatesAPI } from "./api/flow-templates-api";
import { flowPublishAPI } from "./api/flow-publish-api";
import { flowVersionsAPI } from "./api/flow-versions-api";
import { flowDraftsAPI } from "./api/flow-drafts-api";
import { flowImportExportAPI } from "./api/flow-import-export-api";
import { templateInstallAPI } from "./api/template-install-api";
import { flowBuilderAPI } from "./api/flow-builder-api";

import { handleTrigger } from "./flow/trigger-handler";

export async function router(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  /* =========================================================
     ROOT / HEALTH / STATUS
  ========================================================= */

  if (method === "GET" && pathname === "/") {
    return jsonResponse({
      ok: true,
      service: env.APP_NAME,
      environment: env.ENVIRONMENT,
      route: "/",
      message: "IAI Flow Engine is running",
      timestamp: new Date().toISOString()
    });
  }

  if (method === "GET" && pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: env.APP_NAME,
      environment: env.ENVIRONMENT,
      route: "/health",
      timestamp: new Date().toISOString()
    });
  }

  if (method === "GET" && pathname === "/api/status") {
    return jsonResponse({
      ok: true,
      service: env.APP_NAME,
      environment: env.ENVIRONMENT,
      runtime: "cloudflare-workers",
      bindings: {
        d1: !!env.DB,
        sessionsKv: !!env.SESSIONS_KV,
        rateLimitsKv: !!env.RATE_LIMITS_KV,
        cacheKv: !!env.CACHE_KV,
        executionCoordinator: !!env.EXECUTION_COORDINATOR
      },
      timestamp: new Date().toISOString()
    });
  }

  /* =========================================================
     TRIGGER ROUTES
  ========================================================= */

  if (pathname.startsWith("/api/trigger")) {
    return handleTrigger(request, env, ctx);
  }

  /* =========================================================
     SECURITY
  ========================================================= */

  const securityResponse = await securityAPI(request, env);
  if (securityResponse) {
    return securityResponse;
  }

  /* =========================================================
     BUILDER / CATALOG / TEMPLATE LAYER
  ========================================================= */

  const nodeCatalogResponse = await nodeCatalogAPI(request, env);
  if (nodeCatalogResponse) {
    return nodeCatalogResponse;
  }

  const flowTemplatesResponse = await flowTemplatesAPI(request, env);
  if (flowTemplatesResponse) {
    return flowTemplatesResponse;
  }

  const templateInstallResponse = await templateInstallAPI(request, env);
  if (templateInstallResponse) {
    return templateInstallResponse;
  }

  const flowBuilderResponse = await flowBuilderAPI(request, env);
  if (flowBuilderResponse) {
    return flowBuilderResponse;
  }

  /* =========================================================
     FLOW LIFECYCLE
  ========================================================= */

  const flowPublishResponse = await flowPublishAPI(request, env);
  if (flowPublishResponse) {
    return flowPublishResponse;
  }

  const flowVersionsResponse = await flowVersionsAPI(request, env);
  if (flowVersionsResponse) {
    return flowVersionsResponse;
  }

  const flowDraftsResponse = await flowDraftsAPI(request, env);
  if (flowDraftsResponse) {
    return flowDraftsResponse;
  }

  const flowImportExportResponse = await flowImportExportAPI(request, env);
  if (flowImportExportResponse) {
    return flowImportExportResponse;
  }

  /* =========================================================
     CORE FLOW / EXECUTION APIS
  ========================================================= */

  const flowsResponse = await flowsAPI(request, env);
  if (flowsResponse) {
    return flowsResponse;
  }

  const executionsResponse = await executionsAPI(request, env);
  if (executionsResponse) {
    return executionsResponse;
  }
  
  const flowRunsDashboardResponse = await flowRunsDashboardAPI(request, env);
  if (flowRunsDashboardResponse) {
    return flowRunsDashboardResponse;
  }
  /* =========================================================
     COORDINATOR ROUTES
  ========================================================= */

  if (method === "GET" && pathname === "/api/coordinator") {
    return proxyToCoordinator(request, env, "/");
  }

  if (method === "GET" && pathname === "/api/coordinator/health") {
    return proxyToCoordinator(request, env, "/health");
  }

  if (method === "GET" && pathname === "/api/coordinator/state") {
    return proxyToCoordinator(request, env, "/state");
  }

  if (method === "POST" && pathname === "/api/coordinator/claim") {
    return proxyToCoordinator(request, env, "/claim");
  }

  if (method === "POST" && pathname === "/api/coordinator/release") {
    return proxyToCoordinator(request, env, "/release");
  }

  if (method === "POST" && pathname === "/api/coordinator/reset") {
    return proxyToCoordinator(request, env, "/reset");
  }

  /* =========================================================
     NOT FOUND
  ========================================================= */

  return jsonResponse(
    {
      ok: false,
      error: "not_found",
      message: "Route not found",
      route: pathname,
      timestamp: new Date().toISOString()
    },
    { status: 404 }
  );
}

async function proxyToCoordinator(
  request: Request,
  env: Env,
  coordinatorPath: string
): Promise<Response> {
  const objectId = env.EXECUTION_COORDINATOR.idFromName("global");
  const stub = env.EXECUTION_COORDINATOR.get(objectId);

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(incomingUrl.origin);
  targetUrl.pathname = coordinatorPath;

  const forwardedRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? null
        : request.body,
    redirect: "follow"
  });

  const response = await stub.fetch(forwardedRequest);
  return withJsonCors(response);
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
  applyCors(headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

function withJsonCors(response: Response): Response {
  const headers = new Headers(response.headers);
  applyCors(headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function corsHeaders(): Headers {
  const headers = new Headers();
  applyCors(headers);
  return headers;
}

function applyCors(headers: Headers): void {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, authorization, x-user-id, x-workspace-id, x-internal-api-key"
  );
}
