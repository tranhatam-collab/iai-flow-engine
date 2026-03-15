import {
  NodeRegistry,
  type RuntimeFlowDefinition,
  type RuntimeNodeDefinition,
  type RuntimeNodeExecutionResult
} from "./node-registry";

export interface ExecuteNodeOptions {
  registry: NodeRegistry;
  flow: RuntimeFlowDefinition;
  node: RuntimeNodeDefinition;
  executionId: string;
  input: unknown;
}

export async function executeNode(options: ExecuteNodeOptions): Promise<RuntimeNodeExecutionResult> {
  const handler = options.registry.get(options.node.type);

  if (!handler) {
    return {
      ok: false,
      output: null,
      error: `Unsupported node type: ${options.node.type}`
    };
  }

  return handler.execute({
    input: options.input,
    node: options.node,
    flow: options.flow,
    executionId: options.executionId
  });
}
