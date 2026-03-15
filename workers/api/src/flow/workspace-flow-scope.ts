/* =========================================================
IAI FLOW ENGINE
Workspace Flow Scope
Workspace ownership helpers for flows
========================================================= */

import type { Env } from "../index";

export interface ScopedFlowRow {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

export async function ensureWorkspaceFlowSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flows_workspace_updated
    ON flows (workspace_id, updated_at DESC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_flows_workspace_status
    ON flows (workspace_id, status, updated_at DESC)
  `).run();
}

export async function getScopedFlow(
  flowId: string,
  workspaceId: string,
  env: Env
): Promise<ScopedFlowRow | null> {
  await ensureWorkspaceFlowSchema(env);

  return env.DB.prepare(`
    SELECT
      id,
      workspace_id,
      created_by,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    FROM flows
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `)
    .bind(flowId, workspaceId)
    .first<ScopedFlowRow>();
}

export async function listScopedFlows(
  workspaceId: string,
  env: Env
): Promise<ScopedFlowRow[]> {
  await ensureWorkspaceFlowSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      workspace_id,
      created_by,
      name,
      status,
      version,
      definition_json,
      created_at,
      updated_at
    FROM flows
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
  `)
    .bind(workspaceId)
    .all<ScopedFlowRow>();

  return result.results || [];
}
