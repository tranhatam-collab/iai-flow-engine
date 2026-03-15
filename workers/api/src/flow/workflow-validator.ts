/* =========================================================
IAI FLOW ENGINE
Workflow Validator
Validates workflow structure, node permissions, node configs,
entry resolution and runtime safety before publish/run
========================================================= */

import { guardJSON, guardPrompt } from "../security/runtime-guard";
import {
  getNodeCapability,
  isNodeAllowedForRole,
  nodeExists,
  validateNodeConfig
} from "./node-capabilities";

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "builder"
  | "operator"
  | "analyst"
  | "viewer";

export interface WorkflowValidatorNode {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface WorkflowValidatorEdge {
  from: string;
  to: string;
  branch?: "true" | "false" | "default";
}

export interface WorkflowValidatorDefinition {
  id?: string;
  name?: string;
  entry?: string | null;
  nodes: WorkflowValidatorNode[];
  edges?: Array<WorkflowValidatorEdge | [string, string] | [string, string, string]>;
}

export interface WorkflowValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edge?: {
    from: string;
    to: string;
  };
}

export interface WorkflowValidationResult {
  ok: boolean;
  issues: WorkflowValidationIssue[];
  summary: {
    nodeCount: number;
    edgeCount: number;
    entryNodeId: string | null;
    validNodeCount: number;
  };
}

export function validateWorkflowDefinition(
  workflow: WorkflowValidatorDefinition,
  role: WorkspaceRole
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];

  const normalized = normalizeWorkflow(workflow);

  if (!normalized.nodes.length) {
    issues.push({
      level: "error",
      code: "workflow.empty_nodes",
      message: "Workflow must contain at least one node"
    });
  }

  const nodeIds = new Set<string>();
  const nodeMap = new Map<string, WorkflowValidatorNode>();

  for (const node of normalized.nodes) {
    if (!node.id.trim()) {
      issues.push({
        level: "error",
        code: "node.missing_id",
        message: "Node is missing id"
      });
      continue;
    }

    if (nodeIds.has(node.id)) {
      issues.push({
        level: "error",
        code: "node.duplicate_id",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id
      });
      continue;
    }

    nodeIds.add(node.id);
    nodeMap.set(node.id, node);

    if (!nodeExists(node.type)) {
      issues.push({
        level: "error",
        code: "node.unknown_type",
        message: `Unknown node type: ${node.type}`,
        nodeId: node.id
      });
      continue;
    }

    if (!isNodeAllowedForRole(node.type, role)) {
      issues.push({
        level: "error",
        code: "node.role_not_allowed",
        message: `Role "${role}" is not allowed to use node type "${node.type}"`,
        nodeId: node.id
      });
    }

    const configValidation = validateNodeConfig(node.type, node.config);
    if (!configValidation.ok) {
      issues.push({
        level: "error",
        code: "node.invalid_config",
        message: configValidation.error,
        nodeId: node.id
      });
    }

    const guardResult = guardNodeContent(node);
    if (!guardResult.ok) {
      issues.push({
        level: "error",
        code: "node.runtime_guard",
        message: guardResult.reason || "Runtime guard rejected node config",
        nodeId: node.id
      });
    }

    const capability = getNodeCapability(node.type);
    if (capability && !capability.stable) {
      issues.push({
        level: "warning",
        code: "node.experimental",
        message: `Node type "${node.type}" is not yet marked as stable`,
        nodeId: node.id
      });
    }
  }

  const edges = normalized.edges || [];

  for (const edge of edges) {
    if (!nodeMap.has(edge.from)) {
      issues.push({
        level: "error",
        code: "edge.missing_from",
        message: `Edge source node does not exist: ${edge.from}`,
        edge: { from: edge.from, to: edge.to }
      });
    }

    if (!nodeMap.has(edge.to)) {
      issues.push({
        level: "error",
        code: "edge.missing_to",
        message: `Edge target node does not exist: ${edge.to}`,
        edge: { from: edge.from, to: edge.to }
      });
    }

    if (edge.from === edge.to) {
      issues.push({
        level: "warning",
        code: "edge.self_loop",
        message: `Self-loop detected on node: ${edge.from}`,
        edge: { from: edge.from, to: edge.to }
      });
    }
  }

  const entryNodeId = resolveEntryNodeId(normalized);

  if (!entryNodeId) {
    issues.push({
      level: "error",
      code: "workflow.missing_entry",
      message: "Unable to resolve workflow entry node"
    });
  } else if (!nodeMap.has(entryNodeId)) {
    issues.push({
      level: "error",
      code: "workflow.invalid_entry",
      message: `Workflow entry node does not exist: ${entryNodeId}`
    });
  }

  const unreachable = findUnreachableNodes(normalized, entryNodeId);
  for (const nodeId of unreachable) {
    issues.push({
      level: "warning",
      code: "node.unreachable",
      message: `Node is unreachable from workflow entry: ${nodeId}`,
      nodeId
    });
  }

  return {
    ok: !issues.some((issue) => issue.level === "error"),
    issues,
    summary: {
      nodeCount: normalized.nodes.length,
      edgeCount: edges.length,
      entryNodeId,
      validNodeCount: normalized.nodes.length - issues.filter((i) => i.level === "error" && i.nodeId).length
    }
  };
}

/* =========================================================
NORMALIZATION
========================================================= */

function normalizeWorkflow(workflow: WorkflowValidatorDefinition): WorkflowValidatorDefinition {
  return {
    id: typeof workflow.id === "string" && workflow.id.trim() ? workflow.id.trim() : undefined,
    name: typeof workflow.name === "string" && workflow.name.trim() ? workflow.name.trim() : "Untitled Workflow",
    entry: typeof workflow.entry === "string" && workflow.entry.trim() ? workflow.entry.trim() : null,
    nodes: Array.isArray(workflow.nodes)
      ? workflow.nodes
          .filter(isRecord)
          .map((node) => ({
            id: typeof node.id === "string" ? node.id.trim() : "",
            type: typeof node.type === "string" ? node.type.trim() : "",
            name: typeof node.name === "string" && node.name.trim() ? node.name.trim() : undefined,
            config: isRecord(node.config) ? node.config : {}
          }))
      : [],
    edges: Array.isArray(workflow.edges)
      ? workflow.edges
          .map(normalizeEdge)
          .filter(Boolean) as WorkflowValidatorEdge[]
      : []
  };
}

function normalizeEdge(
  input: WorkflowValidatorEdge | [string, string] | [string, string, string]
): WorkflowValidatorEdge | null {
  if (Array.isArray(input)) {
    if (
      input.length >= 2 &&
      typeof input[0] === "string" &&
      typeof input[1] === "string"
    ) {
      return {
        from: input[0].trim(),
        to: input[1].trim(),
        branch:
          input.length >= 3 && typeof input[2] === "string"
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
ENTRY + GRAPH CHECKS
========================================================= */

function resolveEntryNodeId(workflow: WorkflowValidatorDefinition): string | null {
  if (workflow.entry) {
    return workflow.entry;
  }

  if (!workflow.nodes.length) {
    return null;
  }

  const edges = workflow.edges || [];

  if (!edges.length) {
    return workflow.nodes[0]?.id || null;
  }

  const allTargets = new Set(edges.map((edge) => edge.to));
  const root = workflow.nodes.find((node) => !allTargets.has(node.id));

  return root?.id || workflow.nodes[0]?.id || null;
}

function findUnreachableNodes(
  workflow: WorkflowValidatorDefinition,
  entryNodeId: string | null
): string[] {
  if (!entryNodeId) {
    return workflow.nodes.map((node) => node.id);
  }

  const outgoing = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    outgoing.set(node.id, []);
  }

  for (const edge of workflow.edges || []) {
    const list = outgoing.get(edge.from) || [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  const visited = new Set<string>();
  const queue: string[] = [entryNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;

    visited.add(current);

    for (const next of outgoing.get(current) || []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return workflow.nodes
    .map((node) => node.id)
    .filter((nodeId) => !visited.has(nodeId));
}

/* =========================================================
RUNTIME GUARD
========================================================= */

function guardNodeContent(node: WorkflowValidatorNode): { ok: boolean; reason?: string } {
  const jsonGuard = guardJSON(node.config || {});
  if (!jsonGuard.ok) {
    return jsonGuard;
  }

  if (isRecord(node.config)) {
    for (const value of Object.values(node.config)) {
      if (typeof value === "string") {
        const promptGuard = guardPrompt(value);
        if (!promptGuard.ok) {
          return promptGuard;
        }
      }
    }
  }

  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
