import type { Env } from "../index";
import { executeNode } from "./node-executor";
import {
  NodeRegistry,
  type RuntimeEdgeDefinition,
  type RuntimeFlowDefinition,
  type RuntimeNodeDefinition
} from "./node-registry";

interface FlowRow {
  id: string;
  name: string;
  status: string;
  definition_json: string;
}

export async function runFlowById(
  flowId: string,
  input: Record<string, unknown>,
  env: Env
): Promise<Record<string, unknown>> {
  await ensureSchemas(env);

  const flow = await env.DB.prepare(`
    SELECT id, name, status, definition_json
    FROM flows
    WHERE id = ?
    LIMIT 1
  `)
    .bind(flowId)
    .first<FlowRow>();

  if (!flow) {
    return {
      ok: false,
      error: "flow_not_found",
      message: "Flow not found"
    };
  }

  const definition = parseFlowDefinition(flow.definition_json, flow.name);
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO flow_executions (
      id,
      flow_id,
      status,
      input_json,
      output_json,
      error_message,
      started_at,
      completed_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      executionId,
      flowId,
      "running",
      JSON.stringify(input || {}),
      null,
      null,
      startedAt,
      null,
      startedAt
    )
    .run();

  const coordinatorId = env.EXECUTION_COORDINATOR.idFromName("global");
  const coordinator = env.EXECUTION_COORDINATOR.get(coordinatorId);

  await coordinator.fetch("https://internal/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ runId: executionId })
  });

  const registry = new NodeRegistry();
  const orderedNodes = resolveExecutionOrder(definition);
  let currentPayload: unknown = input || {};
  const steps: Array<Record<string, unknown>> = [];

  try {
    for (const node of orderedNodes) {
      const result = await executeNode({
        registry,
        flow: definition,
        node,
        executionId,
        input: currentPayload
      });

      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        ok: result.ok,
        output: result.output,
        error: result.error || null
      });

      if (!result.ok) {
        const completedAt = new Date().toISOString();

        await env.DB.prepare(`
          UPDATE flow_executions
          SET status = ?, output_json = ?, error_message = ?, completed_at = ?
          WHERE id = ?
        `)
          .bind(
            "failed",
            JSON.stringify({ steps }),
            result.error || "Node execution failed",
            completedAt,
            executionId
          )
          .run();

        await coordinator.fetch("https://internal/release", {
          method: "POST"
        });

        return {
          ok: false,
          executionId,
          flowId,
          status: "failed",
          steps,
          error: result.error || "Node execution failed"
        };
      }

      currentPayload = result.output;
    }

    const completedAt = new Date().toISOString();

    await env.DB.prepare(`
      UPDATE flow_executions
      SET status = ?, output_json = ?, completed_at = ?
      WHERE id = ?
    `)
      .bind(
        "completed",
        JSON.stringify({
          finalOutput: currentPayload,
          steps
        }),
        completedAt,
        executionId
      )
      .run();

    await coordinator.fetch("https://internal/release", {
      method: "POST"
    });

    return {
      ok: true,
      executionId,
      flowId,
      status: "completed",
      output: currentPayload,
      steps
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Unknown runtime error";

    await env.DB.prepare(`
      UPDATE flow_executions
      SET status = ?, output_json = ?, error_message = ?, completed_at = ?
      WHERE id = ?
    `)
      .bind(
        "failed",
        JSON.stringify({ steps }),
        message,
        completedAt,
        executionId
      )
      .run();

    await coordinator.fetch("https://internal/release", {
      method: "POST"
    });

    return {
      ok: false,
      executionId,
      flowId,
      status: "failed",
      steps,
      error: message
    };
  }
}

async function ensureSchemas(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flow_executions (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
}

function parseFlowDefinition(raw: string, fallbackName: string): RuntimeFlowDefinition {
  try {
    const parsed = JSON.parse(raw);

    return {
      name: typeof parsed.name === "string" ? parsed.name : fallbackName,
      entry: typeof parsed.entry === "string" ? parsed.entry : null,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: normalizeEdges(parsed.edges)
    };
  } catch {
    return {
      name: fallbackName,
      entry: null,
      nodes: [],
      edges: []
    };
  }
}

function normalizeEdges(input: unknown): RuntimeEdgeDefinition[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (isRecord(item) && typeof item.from === "string" && typeof item.to === "string") {
        return { from: item.from, to: item.to };
      }

      if (
        Array.isArray(item) &&
        item.length >= 2 &&
        typeof item[0] === "string" &&
        typeof item[1] === "string"
      ) {
        return { from: item[0], to: item[1] };
      }

      return null;
    })
    .filter(Boolean) as RuntimeEdgeDefinition[];
}

function resolveExecutionOrder(flow: RuntimeFlowDefinition): RuntimeNodeDefinition[] {
  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    return [];
  }

  if (!Array.isArray(flow.edges) || flow.edges.length === 0) {
    return flow.nodes;
  }

  const nodeMap = new Map(flow.nodes.map((node) => [node.id, node]));
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of flow.nodes) {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of flow.edges) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const queue: string[] = [];
  const ordered: RuntimeNodeDefinition[] = [];

  const preferredEntry =
    typeof flow.entry === "string" && nodeMap.has(flow.entry) ? flow.entry : null;

  if (preferredEntry && (incomingCount.get(preferredEntry) || 0) === 0) {
    queue.push(preferredEntry);
  }

  for (const node of flow.nodes) {
    if ((incomingCount.get(node.id) || 0) === 0 && !queue.includes(node.id)) {
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    if (ordered.find((item) => item.id === nodeId)) continue;

    ordered.push(node);

    for (const next of outgoing.get(nodeId) || []) {
      incomingCount.set(next, (incomingCount.get(next) || 0) - 1);
      if ((incomingCount.get(next) || 0) <= 0) {
        queue.push(next);
      }
    }
  }

  for (const node of flow.nodes) {
    if (!ordered.find((item) => item.id === node.id)) {
      ordered.push(node);
    }
  }

  return ordered;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
