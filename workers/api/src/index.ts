import { router } from "./router";
import { ExecutionCoordinator } from "./durable/execution-coordinator";

export { ExecutionCoordinator };

export interface Env {
  APP_NAME: string;
  ENVIRONMENT: string;
  SESSION_COOKIE_NAME: string;

  DB: D1Database;

  SESSIONS_KV: KVNamespace;
  RATE_LIMITS_KV: KVNamespace;
  CACHE_KV: KVNamespace;

  FLOW_RUNTIME_SECRET: string;
  GITHUB_PAT?: string;
  INTERNAL_API_KEY?: string;

  EXECUTION_COORDINATOR: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      if (request.method.toUpperCase() === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders()
        });
      }

      return await router(request, env, ctx);
    } catch (error) {
      return handleError(error, env);
    }
  }
};

function handleError(error: unknown, env: Env): Response {
  const message =
    error instanceof Error ? error.message : "Internal Server Error";

  return new Response(
    JSON.stringify(
      {
        ok: false,
        error: "internal_error",
        message,
        service: env.APP_NAME || "IAI Flow Engine",
        timestamp: new Date().toISOString()
      },
      null,
      2
    ),
    {
      status: 500,
      headers: jsonHeaders()
    }
  );
}

function jsonHeaders(): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type, authorization, x-internal-api-key");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return headers;
}

function corsHeaders(): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type, authorization, x-internal-api-key");
  return headers;
}
