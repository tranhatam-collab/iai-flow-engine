/* =========================================================
IAI FLOW ENGINE
Execution Log
Persists workflow execution logs into D1
========================================================= */

import type { Env } from "../index";
import type { WorkflowRunResult, WorkflowStepLog } from "./workflow-runtime";

interface ExecutionLogRow {
  id: string;
  execution_id: string;
  workflow_id: string | null;
  workspace_id: string;
  user_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  final_output_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ExecutionStepRow {
  id: string;
  execution_id: string;
  step_index: number;
  node_id: string;
  node_type: string;
  node_name: string | null;
  success: number;
  started_at: string;
  completed_at: string;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  created_at: string;
}

export async function ensureExecutionLogSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      final_output_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS execution_step_logs (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      node_name TEXT,
      success INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id
    ON execution_logs (execution_id)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_logs_workspace_id
    ON execution_logs (workspace_id, created_at DESC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_step_logs_execution_id
    ON execution_step_logs (execution_id, step_index ASC)
  `).run();
}

export async function createExecutionLog(input: {
  executionId: string;
  workflowId: string | null;
  workspaceId: string;
  userId: string;
  status: string;
  startedAt: string;
  env: Env;
}): Promise<void> {
  await ensureExecutionLogSchema(input.env);

  const now = new Date().toISOString();

  await input.env.DB.prepare(`
    INSERT OR REPLACE INTO execution_logs (
      id,
      execution_id,
      workflow_id,
      workspace_id,
      user_id,
      status,
      started_at,
      completed_at,
      final_output_json,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      input.executionId,
      input.workflowId,
      input.workspaceId,
      input.userId,
      input.status,
      input.startedAt,
      null,
      null,
      null,
      now,
      now
    )
    .run();
}

export async function finalizeExecutionLog(input: {
  executionId: string;
  workspaceId: string;
  userId: string;
  result: WorkflowRunResult;
  env: Env;
}): Promise<void> {
  await ensureExecutionLogSchema(input.env);

  const now = new Date().toISOString();

  await input.env.DB.prepare(`
    UPDATE execution_logs
    SET
      status = ?,
      completed_at = ?,
      final_output_json = ?,
      error_message = ?,
      updated_at = ?
    WHERE execution_id = ?
  `)
    .bind(
      input.result.status,
      input.result.completedAt,
      JSON.stringify(input.result.finalOutput ?? null),
      input.result.error || null,
      now,
      input.executionId
    )
    .run();

  await replaceExecutionSteps(
    input.executionId,
    input.result.steps,
    input.env
  );
}

export async function replaceExecutionSteps(
  executionId: string,
  steps: WorkflowStepLog[],
  env: Env
): Promise<void> {
  await ensureExecutionLogSchema(env);

  await env.DB.prepare(`
    DELETE FROM execution_step_logs
    WHERE execution_id = ?
  `)
    .bind(executionId)
    .run();

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    await env.DB.prepare(`
      INSERT INTO execution_step_logs (
        id,
        execution_id,
        step_index,
        node_id,
        node_type,
        node_name,
        success,
        started_at,
        completed_at,
        input_json,
        output_json,
        error_message,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        executionId,
        i,
        step.nodeId,
        step.nodeType,
        step.nodeName,
        step.success ? 1 : 0,
        step.startedAt,
        step.completedAt,
        JSON.stringify(step.input ?? null),
        JSON.stringify(step.output ?? null),
        step.error || null,
        new Date().toISOString()
      )
      .run();
  }
}

export async function getExecutionLog(
  executionId: string,
  env: Env
): Promise<Record<string, unknown> | null> {
  await ensureExecutionLogSchema(env);

  const execution = await env.DB.prepare(`
    SELECT
      id,
      execution_id,
      workflow_id,
      workspace_id,
      user_id,
      status,
      started_at,
      completed_at,
      final_output_json,
      error_message,
      created_at,
      updated_at
    FROM execution_logs
    WHERE execution_id = ?
    LIMIT 1
  `)
    .bind(executionId)
    .first<ExecutionLogRow>();

  if (!execution) {
    return null;
  }

  const stepsResult = await env.DB.prepare(`
    SELECT
      id,
      execution_id,
      step_index,
      node_id,
      node_type,
      node_name,
      success,
      started_at,
      completed_at,
      input_json,
      output_json,
      error_message,
      created_at
    FROM execution_step_logs
    WHERE execution_id = ?
    ORDER BY step_index ASC
  `)
    .bind(executionId)
    .all<ExecutionStepRow>();

  return {
    executionId: execution.execution_id,
    workflowId: execution.workflow_id,
    workspaceId: execution.workspace_id,
    userId: execution.user_id,
    status: execution.status,
    startedAt: execution.started_at,
    completedAt: execution.completed_at,
    finalOutput: safeParseJson(execution.final_output_json),
    errorMessage: execution.error_message,
    createdAt: execution.created_at,
    updatedAt: execution.updated_at,
    steps: (stepsResult.results || []).map((step) => ({
      id: step.id,
      executionId: step.execution_id,
      stepIndex: step.step_index,
      nodeId: step.node_id,
      nodeType: step.node_type,
      nodeName: step.node_name,
      success: !!step.success,
      startedAt: step.started_at,
      completedAt: step.completed_at,
      input: safeParseJson(step.input_json),
      output: safeParseJson(step.output_json),
      errorMessage: step.error_message,
      createdAt: step.created_at
    }))
  };
}

export async function listExecutionLogs(
  workspaceId: string,
  env: Env
): Promise<Array<Record<string, unknown>>> {
  await ensureExecutionLogSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      execution_id,
      workflow_id,
      workspace_id,
      user_id,
      status,
      started_at,
      completed_at,
      final_output_json,
      error_message,
      created_at,
      updated_at
    FROM execution_logs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `)
    .bind(workspaceId)
    .all<ExecutionLogRow>();

  return (result.results || []).map((row) => ({
    executionId: row.execution_id,
    workflowId: row.workflow_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    finalOutput: safeParseJson(row.final_output_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
