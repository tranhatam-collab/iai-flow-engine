/* =========================================================
IAI FLOW ENGINE
Flow Runs Dashboard API
Workspace-scoped dashboard metrics for builder/frontend
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";

interface ExecutionLogRow {
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

export async function flowRunsDashboardAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/dashboard/runs" && method === "GET") {
    return getRunsDashboard(request, env, url);
  }

  if (pathname === "/api/dashboard/runs/latest" && method === "GET") {
    return getLatestRuns(request, env, url);
  }

  return null;
}

/* =========================================================
DASHBOARD SUMMARY
========================================================= */

async function getRunsDashboard(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "execution.read");

  await ensureExecutionDashboardSchema(env);

  const flowId = (url.searchParams.get("flowId") || "").trim() || null;
  const limitDays = parsePositiveInt(url.searchParams.get("days"), 30);

  const rows = await loadExecutionRows(
    identity.workspaceId,
    env,
    flowId,
    limitDays,
    500
  );

  const totalRuns = rows.length;
  const completedRuns = rows.filter((row) => row.status === "completed").length;
  const failedRuns = rows.filter((row) => row.status === "failed").length;
  const runningRuns = rows.filter((row) => row.status === "running").length;

  const successRate = totalRuns > 0 ? round2((completedRuns / totalRuns) * 100) : 0;
  const failRate = totalRuns > 0 ? round2((failedRuns / totalRuns) * 100) : 0;

  const durations = rows
    .map(getDurationMs)
    .filter((value): value is number => typeof value === "number" && value >= 0);

  const averageDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, current) => sum + current, 0) / durations.length)
      : 0;

  const latestRun = rows[0] || null;

  const byStatus = {
    completed: completedRuns,
    failed: failedRuns,
    running: runningRuns,
    other: Math.max(0, totalRuns - completedRuns - failedRuns - runningRuns)
  };

  const trend = buildDailyTrend(rows, limitDays);

  return jsonResponse({
    ok: true,
    item: {
      workspaceId: identity.workspaceId,
      flowId,
      windowDays: limitDays,
      totals: {
        totalRuns,
        completedRuns,
        failedRuns,
        runningRuns
      },
      rates: {
        successRate,
        failRate
      },
      performance: {
        averageDurationMs,
        averageDurationSeconds: round2(averageDurationMs / 1000)
      },
      byStatus,
      latestRun: latestRun
        ? mapExecutionRow(latestRun)
        : null,
      trend
    }
  });
}

/* =========================================================
LATEST RUNS
========================================================= */

async function getLatestRuns(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "execution.read");

  await ensureExecutionDashboardSchema(env);

  const flowId = (url.searchParams.get("flowId") || "").trim() || null;
  const limit = parsePositiveInt(url.searchParams.get("limit"), 20);

  const rows = await loadExecutionRows(
    identity.workspaceId,
    env,
    flowId,
    90,
    limit
  );

  return jsonResponse({
    ok: true,
    items: rows.map(mapExecutionRow)
  });
}

/* =========================================================
DATA LOADING
========================================================= */

async function loadExecutionRows(
  workspaceId: string,
  env: Env,
  flowId: string | null,
  days: number,
  limit: number
): Promise<ExecutionLogRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (flowId) {
    const result = await env.DB.prepare(`
      SELECT
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
        AND workflow_id = ?
        AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
      .bind(workspaceId, flowId, since, limit)
      .all<ExecutionLogRow>();

    return result.results || [];
  }

  const result = await env.DB.prepare(`
    SELECT
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
      AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT ?
  `)
    .bind(workspaceId, since, limit)
    .all<ExecutionLogRow>();

  return result.results || [];
}

/* =========================================================
SCHEMA
========================================================= */

async function ensureExecutionDashboardSchema(env: Env): Promise<void> {
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
    CREATE INDEX IF NOT EXISTS idx_execution_logs_workspace_created
    ON execution_logs (workspace_id, created_at DESC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_execution_logs_workspace_workflow_created
    ON execution_logs (workspace_id, workflow_id, created_at DESC)
  `).run();
}

/* =========================================================
MAPPERS
========================================================= */

function mapExecutionRow(row: ExecutionLogRow): Record<string, unknown> {
  const durationMs = getDurationMs(row);

  return {
    executionId: row.execution_id,
    flowId: row.workflow_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs,
    durationSeconds: typeof durationMs === "number" ? round2(durationMs / 1000) : null,
    finalOutput: safeParseJson(row.final_output_json),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildDailyTrend(
  rows: ExecutionLogRow[],
  days: number
): Array<Record<string, unknown>> {
  const buckets = new Map<string, {
    date: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
  }>();

  for (let i = 0; i < days; i += 1) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    buckets.set(date, {
      date,
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0
    });
  }

  for (const row of rows) {
    const date = row.created_at.slice(0, 10);
    const bucket = buckets.get(date);
    if (!bucket) continue;

    bucket.totalRuns += 1;
    if (row.status === "completed") bucket.completedRuns += 1;
    if (row.status === "failed") bucket.failedRuns += 1;
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/* =========================================================
UTILS
========================================================= */

function getDurationMs(row: ExecutionLogRow): number | null {
  if (!row.started_at || !row.completed_at) return null;

  const start = Date.parse(row.started_at);
  const end = Date.parse(row.completed_at);

  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

function safeParseJson(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, authorization, x-user-id, x-workspace-id, x-internal-api-key"
  );

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}
