import { json, notFound, serverError, withCors } from "./lib/json";
import { Env } from "./lib/db";
import { handleWorkflows } from "./routes/workflows";
import { handleRuns } from "./routes/runs";
import { handleLogs } from "./routes/logs";
import { handleMetrics } from "./routes/metrics";
import { ExecutionCoordinator } from "./durable/execution-coordinator";

export { ExecutionCoordinator };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/+|\/+$/g, "");
      const parts = path ? path.split("/") : [];

      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      if (parts.length === 0) {
        return withCors(
          json({
            ok: true,
            service: env.APP_NAME || "IAI Flow",
            version: "1.0.0",
            language: env.DEFAULT_LANGUAGE || "vi",
          }),
        );
      }

      if (parts[0] === "api" && parts[1] === "workflows") {
        return withCors(await handleWorkflows(request, env, parts.slice(2)));
      }

      if (parts[0] === "api" && parts[1] === "runs") {
        return withCors(await handleRuns(request, env, parts.slice(2)));
      }

      if (parts[0] === "api" && parts[1] === "logs") {
        return withCors(await handleLogs(request, env, parts.slice(2)));
      }

      if (parts[0] === "api" && parts[1] === "metrics" && parts.length === 2) {
        return withCors(await handleMetrics(request, env));
      }

      return withCors(notFound("Route not found"));
    } catch (error) {
      return withCors(serverError("Unhandled API error", String(error)));
    }
  },
};