import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";

interface CoordinatorState {
  coordinatorId: string;
  lastRunId: string | null;
  activeRuns: number;
  updatedAt: string;
}

interface ClaimRequestBody {
  runId?: string;
}

export class ExecutionCoordinator extends DurableObject<Env> {
  private stateStore: DurableObjectState;
  private envStore: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.stateStore = state;
    this.envStore = env;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const pathname = normalizePath(url.pathname);
      const method = request.method.toUpperCase();

      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders()
        });
      }

      if (method === "GET" && pathname === "/") {
        return this.json({
          ok: true,
          object: "ExecutionCoordinator",
          app: this.envStore.APP_NAME,
          environment: this.envStore.ENVIRONMENT,
          timestamp: new Date().toISOString()
        });
      }

      if (method === "GET" && pathname === "/health") {
        const snapshot = await this.getState();

        return this.json({
          ok: true,
          health: "alive",
          coordinator: snapshot
        });
      }

      if (method === "GET" && pathname === "/state") {
        const snapshot = await this.getState();

        return this.json({
          ok: true,
          state: snapshot
        });
      }

      if (method === "POST" && pathname === "/claim") {
        const body = await this.readJson<ClaimRequestBody>(request);
        const runId = body.runId || crypto.randomUUID();
        const snapshot = await this.getState();

        const nextState: CoordinatorState = {
          coordinatorId: snapshot.coordinatorId,
          lastRunId: runId,
          activeRuns: snapshot.activeRuns + 1,
          updatedAt: new Date().toISOString()
        };

        await this.stateStore.storage.put("coordinator_state", nextState);

        return this.json({
          ok: true,
          claimed: true,
          runId,
          state: nextState
        });
      }

      if (method === "POST" && pathname === "/release") {
        const snapshot = await this.getState();

        const nextState: CoordinatorState = {
          coordinatorId: snapshot.coordinatorId,
          lastRunId: snapshot.lastRunId,
          activeRuns: Math.max(0, snapshot.activeRuns - 1),
          updatedAt: new Date().toISOString()
        };

        await this.stateStore.storage.put("coordinator_state", nextState);

        return this.json({
          ok: true,
          released: true,
          state: nextState
        });
      }

      if (method === "POST" && pathname === "/reset") {
        const nextState: CoordinatorState = {
          coordinatorId: this.stateStore.id.toString(),
          lastRunId: null,
          activeRuns: 0,
          updatedAt: new Date().toISOString()
        };

        await this.stateStore.storage.put("coordinator_state", nextState);

        return this.json({
          ok: true,
          reset: true,
          state: nextState
        });
      }

      return this.json(
        {
          ok: false,
          error: "not_found",
          message: "Coordinator route not found",
          route: pathname
        },
        404
      );
    } catch (error) {
      return this.json(
        {
          ok: false,
          error: "coordinator_error",
          message: error instanceof Error ? error.message : "Unknown coordinator error"
        },
        500
      );
    }
  }

  private async getState(): Promise<CoordinatorState> {
    const existing = await this.stateStore.storage.get<CoordinatorState>("coordinator_state");

    if (existing) {
      return existing;
    }

    const initialState: CoordinatorState = {
      coordinatorId: this.stateStore.id.toString(),
      lastRunId: null,
      activeRuns: 0,
      updatedAt: new Date().toISOString()
    };

    await this.stateStore.storage.put("coordinator_state", initialState);
    return initialState;
  }

  private async readJson<T>(request: Request): Promise<T> {
    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return {} as T;
    }

    return (await request.json()) as T;
  }

  private json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: jsonHeaders()
    });
  }
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function jsonHeaders(): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type, authorization, x-internal-api-key");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return headers;
}

function corsHeaders(): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type, authorization, x-internal-api-key");
  return headers;
}
