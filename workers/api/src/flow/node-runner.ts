/* =========================================================
IAI FLOW ENGINE
Node Runner
Executes individual workflow nodes
Compatible with Cloudflare Workers runtime
========================================================= */

export interface FlowNode {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, any>;
}

export interface NodeExecutionContext {
  workspaceId: string;
  userId: string;
  executionId: string;
  input: any;
  env?: any;
}

export interface NodeExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
}

type NodeExecutor = (
  node: FlowNode,
  ctx: NodeExecutionContext
) => Promise<NodeExecutionResult>;

const registry = new Map<string, NodeExecutor>();

/* =========================================================
PUBLIC API
========================================================= */

export function registerNode(
  type: string,
  executor: NodeExecutor
): void {
  registry.set(type, executor);
}

export async function runNode(
  node: FlowNode,
  ctx: NodeExecutionContext
): Promise<NodeExecutionResult> {
  const executor = registry.get(node.type);

  if (!executor) {
    return {
      success: false,
      error: `node type not supported: ${node.type}`
    };
  }

  try {
    return await executor(node, ctx);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "node execution failed"
    };
  }
}

export function listNodeTypes(): string[] {
  return Array.from(registry.keys()).sort();
}

/* =========================================================
HELPERS
========================================================= */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/* =========================================================
BUILT-IN NODE: TRIGGER
========================================================= */

registerNode(
  "trigger",
  async (_node, ctx) => {
    return {
      success: true,
      output: cloneValue(ctx.input)
    };
  }
);

/* =========================================================
BUILT-IN NODE: LOG
========================================================= */

registerNode(
  "log",
  async (node, ctx) => {
    console.log(
      "[IAI FLOW][LOG]",
      JSON.stringify({
        executionId: ctx.executionId,
        nodeId: node.id,
        nodeName: node.name || null,
        input: ctx.input
      })
    );

    return {
      success: true,
      output: cloneValue(ctx.input)
    };
  }
);

/* =========================================================
BUILT-IN NODE: SET
========================================================= */

registerNode(
  "set",
  async (node, ctx) => {
    const config = isRecord(node.config) ? node.config : {};
    const value = "value" in config ? cloneValue(config.value) : null;

    return {
      success: true,
      output: value
    };
  }
);

/* =========================================================
BUILT-IN NODE: TRANSFORM
========================================================= */

registerNode(
  "transform",
  async (node, ctx) => {
    const config = isRecord(node.config) ? node.config : {};
    const template = typeof config.template === "string" ? config.template : "";

    if (!template.trim()) {
      return {
        success: false,
        error: "transform node missing template"
      };
    }

    const rendered = template.replace(/\{\{input\}\}/g, JSON.stringify(ctx.input));

    return {
      success: true,
      output: rendered
    };
  }
);

/* =========================================================
BUILT-IN NODE: IF
========================================================= */

registerNode(
  "if",
  async (node, ctx) => {
    const config = isRecord(node.config) ? node.config : {};
    const key = typeof config.key === "string" ? config.key : "";
    const expectedValue = config.value;

    if (!key.trim()) {
      return {
        success: false,
        error: "missing condition key"
      };
    }

    const actualValue = isRecord(ctx.input) ? ctx.input[key] : undefined;
    const pass = actualValue === expectedValue;

    return {
      success: true,
      output: {
        pass,
        actualValue,
        expectedValue
      }
    };
  }
);

/* =========================================================
BUILT-IN NODE: HTTP
========================================================= */

registerNode(
  "http",
  async (node, ctx) => {
    const config = isRecord(node.config) ? node.config : {};
    const url = typeof config.url === "string" ? config.url : "";
    const method = typeof config.method === "string"
      ? config.method.toUpperCase()
      : "GET";

    if (!url.trim()) {
      return {
        success: false,
        error: "missing url"
      };
    }

    const headers = new Headers();
    headers.set("content-type", "application/json");

    const response = await fetch(url, {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : JSON.stringify(ctx.input ?? {})
    });

    const contentType = response.headers.get("content-type") || "";
    let output: unknown;

    if (contentType.includes("application/json")) {
      output = await response.json();
    } else {
      output = await response.text();
    }

    return {
      success: response.ok,
      output: {
        status: response.status,
        ok: response.ok,
        data: output
      },
      error: response.ok ? undefined : `HTTP request failed with status ${response.status}`
    };
  }
);

/* =========================================================
BUILT-IN NODE: RUNTIME
========================================================= */

registerNode(
  "runtime",
  async (node, ctx) => {
    const config = isRecord(node.config) ? node.config : {};
    const action = typeof config.action === "string" ? config.action : "inspect";

    return {
      success: true,
      output: {
        action,
        executionId: ctx.executionId,
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        environment: ctx.env || null,
        input: cloneValue(ctx.input)
      }
    };
  }
);

/* =========================================================
BUILT-IN NODE: AGENT
Placeholder production-safe executor
========================================================= */

registerNode(
  "agent",
  async (node, ctx) => {
    const config = isRecord(node.config) ? node.config : {};
    const instruction =
      typeof config.instruction === "string" ? config.instruction : "";
    const model =
      typeof config.model === "string" ? config.model : "mock-agent";

    return {
      success: true,
      output: {
        agent: {
          model,
          instruction,
          mode: "mock"
        },
        received: cloneValue(ctx.input),
        message: "Agent node executed in mock mode"
      }
    };
  }
);
