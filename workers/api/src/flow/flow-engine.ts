/* =========================================================
IAI FLOW ENGINE
Flow Engine
Loads workflow definitions, runs workflow runtime,
coordinates execution logging and persistence
========================================================= */

import type { Env } from "../index";
import { runWorkflow, type FlowDefinition, type WorkflowRunResult } from "./workflow-runtime";
import {
  createExecutionLog,
  ensureExecutionLogSchema,
  finalizeExecutionLog,
  getExecutionLog,
  listExecutionLogs
} from "./execution-log";

interface FlowRow {
  id: string;
  name: string;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

interface FlowExecutionRow {
  id: string;
  flow_id: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export async function ensureFlowEngineSchema(env: Env): Promise<void> {
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

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flow_executions_flow_id
    ON flow_executions (flow_id, created_at DESC)
  `).run();

  await ensureExecutionLogSchema(env);
}

export async function runFlowEngine(input: {
  flowId: string;
  workspaceId: string;
  userId: string;
  payload: Record<string, unknown>;
  env: Env;
}): Promise<Record<string, unknown>> {
  await ensureFlowEngineSchema(input.env);

  const flow = await input.env.DB.prepare(`
    SELECT
      id,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    FROM flows
    WHERE id = ?
    LIMIT 1
  `)
    .bind(input.flowId)
    .first<FlowRow>();

  if (!flow) {
    return {
      ok: false,
      error: "flow_not_found",
      message: "Flow not found"
    };
  }

  if (flow.status === "archived") {
    return {
      ok: false,
      error: "flow_archived",
      message: "Archived flow cannot be executed"
    };
  }

  const definition = parseFlowDefinition(flow.definition_json, flow.id, flow.name);
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await input.env.DB.prepare(`
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
      input.flowId,
      "running",
      JSON.stringify(input.payload || {}),
      null,
      null,
      startedAt,
      null,
      startedAt
    )
    .run();

  await createExecutionLog({
    executionId,
    workflowId: input.flowId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    status: "running",
    startedAt,
    env: input.env
  });

  const coordinatorId = input.env.EXECUTION_COORDINATOR.idFromName("global");
  const coordinator = input.env.EXECUTION_COORDINATOR.get(coordinatorId);

  await coordinator.fetch("https://internal/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      runId: executionId
    })
  });

  let runtimeResult: WorkflowRunResult;

  try {
    runtimeResult = await runWorkflow({
      workflow: definition,
      workspaceId: input.workspaceId,
      userId: input.userId,
      executionId,
      input: input.payload || {},
      env: {
        appName: input.env.APP_NAME,
        environment: input.env.ENVIRONMENT
      }
    });
  } catch (error) {
    runtimeResult = {
      success: false,
      status: "failed",
      executionId,
      workflowId: flow.id,
      workflowName: flow.name,
      startedAt,
      completedAt: new Date().toISOString(),
      finalOutput: null,
      steps: [],
      error: error instanceof Error ? error.message : "Unknown flow engine error"
    };
  }

  const finalStatus = runtimeResult.status;
  const completedAt = runtimeResult.completedAt;

  await input.env.DB.prepare(`
    UPDATE flow_executions
    SET
      status = ?,
      output_json = ?,
      error_message = ?,
      completed_at = ?
    WHERE id = ?
  `)
    .bind(
      finalStatus,
      JSON.stringify({
        finalOutput: runtimeResult.finalOutput,
        steps: runtimeResult.steps
      }),
      runtimeResult.error || null,
      completedAt,
      executionId
    )
    .run();

  await finalizeExecutionLog({
    executionId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    result: runtimeResult,
    env: input.env
  });

  await coordinator.fetch("https://internal/release", {
    method: "POST"
  });

  return {
    ok: runtimeResult.success,
    executionId,
    flowId: input.flowId,
    workflowName: flow.name,
    status: runtimeResult.status,
    finalOutput: runtimeResult.finalOutput,
    steps: runtimeResult.steps,
    error: runtimeResult.error || null,
    startedAt,
    completedAt
  };
}

export async function getFlowExecution(
  executionId: string,
  env: Env
): Promise<Record<string, unknown> | null> {
  await ensureFlowEngineSchema(env);

  const row = await env.DB.prepare(`
    SELECT
      id,
      flow_id,
      status,
      input_json,
      output_json,
      error_message,
      started_at,
      completed_at,
      created_at
    FROM flow_executions
    WHERE id = ?
    LIMIT 1
  `)
    .bind(executionId)
    .first<FlowExecutionRow>();

  if (!row) {
    return null;
  }

  const executionLog = await getExecutionLog(executionId, env);

  return {
    id: row.id,
    flowId: row.flow_id,
    status: row.status,
    input: safeParseJson(row.input_json),
    output: safeParseJson(row.output_json),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    log: executionLog
  };
}

export async function listFlowEngineExecutions(
  workspaceId: string,
  env: Env
): Promise<Array<Record<string, unknown>>> {
  await ensureFlowEngineSchema(env);
  return listExecutionLogs(workspaceId, env);
}

function parseFlowDefinition(
  raw: string,
  flowId: string,
  fallbackName: string
): FlowDefinition {
  try {
    const parsed = JSON.parse(raw);

    return {
      id: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : flowId,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallbackName,
      entry: typeof parsed.entry === "string" && parsed.entry.trim() ? parsed.entry.trim() : null,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch {
    return {
      id: flowId,
      name: fallbackName,
      entry: null,
      nodes: [],
      edges: []
    };
  }
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
