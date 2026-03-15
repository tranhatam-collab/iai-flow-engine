export interface RuntimeFlowDefinition {
  name?: string;
  entry?: string | null;
  nodes: RuntimeNodeDefinition[];
  edges?: RuntimeEdgeDefinition[];
}

export interface RuntimeNodeDefinition {
  id: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface RuntimeEdgeDefinition {
  from: string;
  to: string;
}

export interface RuntimeNodeExecutionContext {
  input: unknown;
  node: RuntimeNodeDefinition;
  flow: RuntimeFlowDefinition;
  executionId: string;
}

export interface RuntimeNodeExecutionResult {
  ok: boolean;
  output: unknown;
  error?: string;
}

export interface RuntimeNodeHandler {
  type: string;
  execute(context: RuntimeNodeExecutionContext): Promise<RuntimeNodeExecutionResult>;
}

class PassThroughNodeHandler implements RuntimeNodeHandler {
  type: string;

  constructor(type: string) {
    this.type = type;
  }

  async execute(context: RuntimeNodeExecutionContext): Promise<RuntimeNodeExecutionResult> {
    return {
      ok: true,
      output: {
        nodeId: context.node.id,
        nodeType: context.node.type,
        received: context.input,
        config: context.node.config || {},
        processedAt: new Date().toISOString()
      }
    };
  }
}

class TransformNodeHandler implements RuntimeNodeHandler {
  type = "transform";

  async execute(context: RuntimeNodeExecutionContext): Promise<RuntimeNodeExecutionResult> {
    const payload = isRecord(context.input) ? { ...context.input } : { value: context.input };

    return {
      ok: true,
      output: {
        ...payload,
        transformedBy: context.node.id,
        transformedAt: new Date().toISOString()
      }
    };
  }
}

class RuntimeLogsNodeHandler implements RuntimeNodeHandler {
  type = "logs";

  async execute(context: RuntimeNodeExecutionContext): Promise<RuntimeNodeExecutionResult> {
    return {
      ok: true,
      output: {
        logged: true,
        executionId: context.executionId,
        payload: context.input
      }
    };
  }
}

const DEFAULT_NODE_TYPES = [
  "trigger",
  "schedule",
  "agent",
  "classify",
  "api",
  "database",
  "notify",
  "runtime",
  "approve",
  "memory"
];

export class NodeRegistry {
  private handlers: Map<string, RuntimeNodeHandler>;

  constructor() {
    this.handlers = new Map<string, RuntimeNodeHandler>();

    for (const type of DEFAULT_NODE_TYPES) {
      this.register(new PassThroughNodeHandler(type));
    }

    this.register(new TransformNodeHandler());
    this.register(new RuntimeLogsNodeHandler());
  }

  register(handler: RuntimeNodeHandler): void {
    this.handlers.set(handler.type, handler);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  get(type: string): RuntimeNodeHandler | null {
    return this.handlers.get(type) || null;
  }

  list(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
