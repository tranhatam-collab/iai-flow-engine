/* =========================================================
IAI FLOW ENGINE
Workflow Runtime
Runs a workflow definition from start to finish
Compatible with Cloudflare Workers runtime
========================================================= */

import {
  runNode,
  type FlowNode,
  type NodeExecutionContext,
  type NodeExecutionResult
} from "./node-runner";

/* =========================================================
TYPES
========================================================= */

export interface FlowEdge {
  from: string;
  to: string;
  branch?: "true" | "false" | "default";
}

export interface FlowDefinition {
  id?: string;
  name?: string;
  entry?: string | null;
  nodes: FlowNode[];
  edges?: FlowEdge[];
}

export interface RuntimeEnv {
  [key: string]: unknown;
}

export interface WorkflowRunInput {
  workflow: FlowDefinition;
  workspaceId: string;
  userId: string;
  executionId: string;
  input: unknown;
  env?: RuntimeEnv;
}

export interface WorkflowStepLog {
  nodeId: string;
  nodeType: string;
  nodeName: string | null;
  success: boolean;
  startedAt: string;
  completedAt: string;
  input: unknown;
  output: unknown;
  error: string | null;
}

export interface WorkflowRunResult {
  success: boolean;
  status: "completed" | "failed";
  executionId: string;
  workflowId: string | null;
  workflowName: string;
  startedAt: string;
  completedAt: string;
  finalOutput: unknown;
  steps: WorkflowStepLog[];
  error?: string;
}

/* =========================================================
PUBLIC API
========================================================= */

export async function runWorkflow(
  payload: WorkflowRunInput
): Promise<WorkflowRunResult> {
  const startedAt = new Date().toISOString();

  const normalized = normalizeWorkflow(payload.workflow);
  const workflowId = normalized.id || null;
  const workflowName = normalized.name || "Untitled Workflow";
  const steps: WorkflowStepLog[] = [];

  if (!normalized.nodes.length) {
    return {
      success: false,
      status: "failed",
      executionId: payload.executionId,
      workflowId,
      workflowName,
      startedAt,
      completedAt: new Date().toISOString(),
      finalOutput: null,
      steps,
      error: "Workflow has no nodes"
    };
  }

  const nodeMap = buildNodeMap(normalized.nodes);
  const graph = buildGraph(normalized.edges || []);
  const entryNodeId = resolveEntryNodeId(normalized);

  if (!entryNodeId || !nodeMap.has(entryNodeId)) {
    return {
      success: false,
      status: "failed",
      executionId: payload.executionId,
      workflowId,
      workflowName,
      startedAt,
      completedAt: new Date().toISOString(),
      finalOutput: null,
      steps,
      error: "Unable to resolve workflow entry node"
    };
  }

  let currentNodeId: string | null = entryNodeId;
  let currentPayload: unknown = payload.input;
  const visited = new Set<string>();
  let guardCounter = 0;
  const maxSteps = Math.max(normalized.nodes.length * 10, 50);

  while (currentNodeId) {
    guardCounter++;

    if (guardCounter > maxSteps) {
      return {
        success: false,
        status: "failed",
        executionId: payload.executionId,
        workflowId,
        workflowName,
        startedAt,
        completedAt: new Date().toISOString(),
        finalOutput: currentPayload,
        steps,
        error: "Workflow runtime guard triggered: too many steps"
      };
    }

    const node = nodeMap.get(currentNodeId);

    if (!node) {
      return {
        success: false,
        status: "failed",
        executionId: payload.executionId,
        workflowId,
        workflowName,
        startedAt,
        completedAt: new Date().toISOString(),
        finalOutput: currentPayload,
        steps,
        error: `Node not found: ${currentNodeId}`
      };
    }

    const stepStartedAt = new Date().toISOString();

    const nodeContext: NodeExecutionContext = {
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      executionId: payload.executionId,
      input: currentPayload,
      env: payload.env
    };

    const result: NodeExecutionResult = await runNode(node, nodeContext);
    const stepCompletedAt = new Date().toISOString();

    steps.push({
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name || null,
      success: result.success,
      startedAt: stepStartedAt,
      completedAt: stepCompletedAt,
      input: currentPayload,
      output: result.output,
      error: result.error || null
    });

    if (!result.success) {
      return {
        success: false,
        status: "failed",
        executionId: payload.executionId,
        workflowId,
        workflowName,
        startedAt,
        completedAt: new Date().toISOString(),
        finalOutput: result.output ?? currentPayload,
        steps,
        error: result.error || `Node failed: ${node.id}`
      };
    }

    currentPayload = result.output;
    visited.add(node.id);

    const nextNodeId = resolveNextNodeId({
      currentNode: node,
      result,
      graph
    });

    if (!nextNodeId) {
      return {
        success: true,
        status: "completed",
        executionId: payload.executionId,
        workflowId,
        workflowName,
        startedAt,
        completedAt: new Date().toISOString(),
        finalOutput: currentPayload,
        steps
      };
    }

    if (visited.has(nextNodeId) && isLinearLoop(nextNodeId, graph)) {
      return {
        success: false,
        status: "failed",
        executionId: payload.executionId,
        workflowId,
        workflowName,
        startedAt,
        completedAt: new Date().toISOString(),
        finalOutput: currentPayload,
        steps,
        error: `Loop detected at node: ${nextNodeId}`
      };
    }

    currentNodeId = nextNodeId;
  }

  return {
    success: true,
    status: "completed",
    executionId: payload.executionId,
    workflowId,
    workflowName,
    startedAt,
    completedAt: new Date().toISOString(),
    finalOutput: currentPayload,
    steps
  };
}

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeWorkflow(input: FlowDefinition): FlowDefinition {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const edges = Array.isArray(input.edges) ? input.edges : [];

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : undefined,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Untitled Workflow",
    entry: typeof input.entry === "string" && input.entry.trim() ? input.entry.trim() : null,
    nodes: nodes.map(normalizeNode).filter(Boolean),
    edges: edges.map(normalizeEdge).filter(Boolean) as FlowEdge[]
  };
}

function normalizeNode(input: unknown): FlowNode | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || !input.id.trim()) return null;
  if (typeof input.type !== "string" || !input.type.trim()) return null;

  return {
    id: input.id.trim(),
    type: input.type.trim(),
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : undefined,
    config: isRecord(input.config) ? input.config : {}
  };
}

function normalizeEdge(input: unknown): FlowEdge | null {
  if (Array.isArray(input)) {
    if (input.length >= 2 && typeof input[0] === "string" && typeof input[1] === "string") {
      return {
        from: input[0].trim(),
        to: input[1].trim(),
        branch: input.length >= 3 && typeof input[2] === "string"
          ? normalizeBranch(input[2])
          : "default"
      };
    }
    return null;
  }

  if (!isRecord(input)) return null;
  if (typeof input.from !== "string" || typeof input.to !== "string") return null;

  return {
    from: input.from.trim(),
    to: input.to.trim(),
    branch: normalizeBranch(typeof input.branch === "string" ? input.branch : "default")
  };
}

function normalizeBranch(value: string): "true" | "false" | "default" {
  const branch = value.trim().toLowerCase();
  if (branch === "true" || branch === "false") return branch;
  return "default";
}

/* =========================================================
GRAPH
========================================================= */

function buildNodeMap(nodes: FlowNode[]): Map<string, FlowNode> {
  const map = new Map<string, FlowNode>();

  for (const node of nodes) {
    map.set(node.id, node);
  }

  return map;
}

function buildGraph(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const graph = new Map<string, FlowEdge[]>();

  for (const edge of edges) {
    const existing = graph.get(edge.from) || [];
    existing.push(edge);
    graph.set(edge.from, existing);
  }

  return graph;
}

function resolveEntryNodeId(workflow: FlowDefinition): string | null {
  if (workflow.entry) {
    return workflow.entry;
  }

  if (!workflow.edges?.length) {
    return workflow.nodes[0]?.id || null;
  }

  const allTargets = new Set(workflow.edges.map((edge) => edge.to));
  const firstRoot = workflow.nodes.find((node) => !allTargets.has(node.id));

  return firstRoot?.id || workflow.nodes[0]?.id || null;
}

/* =========================================================
NEXT NODE RESOLUTION
========================================================= */

function resolveNextNodeId(input: {
  currentNode: FlowNode;
  result: NodeExecutionResult;
  graph: Map<string, FlowEdge[]>;
}): string | null {
  const outgoing = input.graph.get(input.currentNode.id) || [];

  if (!outgoing.length) {
    return null;
  }

  if (input.currentNode.type === "if") {
    const pass = extractIfPassValue(input.result.output);

    const branchHit = outgoing.find((edge) => edge.branch === (pass ? "true" : "false"));
    if (branchHit) return branchHit.to;

    const fallback = outgoing.find((edge) => edge.branch === "default");
    return fallback?.to || null;
  }

  const defaultEdge =
    outgoing.find((edge) => edge.branch === "default") ||
    outgoing[0];

  return defaultEdge?.to || null;
}

function extractIfPassValue(output: unknown): boolean {
  if (isRecord(output) && typeof output.pass === "boolean") {
    return output.pass;
  }

  return false;
}

function isLinearLoop(nodeId: string, graph: Map<string, FlowEdge[]>): boolean {
  const outgoing = graph.get(nodeId) || [];
  if (!outgoing.length) return false;

  return outgoing.some((edge) => edge.to === nodeId);
}

/* =========================================================
UTILS
========================================================= */

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
