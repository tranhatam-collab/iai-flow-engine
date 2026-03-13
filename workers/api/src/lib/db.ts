export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  FILES: R2Bucket;
  EXECUTION_COORDINATOR: DurableObjectNamespace;
  APP_NAME: string;
  DEFAULT_LANGUAGE: string;
}

export type WorkflowRecord = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
};

export type RunRecord = {
  id: string;
  workflow_id: string | null;
  workflow_name: string;
  status: string;
  node_count: number;
  edge_count: number;
  result_json: string | null;
  error_text: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type LogRecord = {
  id: string;
  run_id: string;
  level: string;
  message: string;
  meta_json: string | null;
  created_at: string;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function toInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function bumpMetric(
  env: Env,
  key: "total_runs" | "success_runs" | "failed_runs",
  increment = 1,
): Promise<void> {
  const current = await env.DB.prepare(
    `SELECT value_text FROM runtime_metrics WHERE key = ? LIMIT 1`,
  )
    .bind(key)
    .first<{ value_text: string }>();

  const nextValue = String((current ? Number(current.value_text) : 0) + increment);

  await env.DB.prepare(`
    INSERT INTO runtime_metrics (key, value_text, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_text = excluded.value_text,
      updated_at = excluded.updated_at
  `)
    .bind(key, nextValue, nowIso())
    .run();
}

export async function setMetric(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO runtime_metrics (key, value_text, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_text = excluded.value_text,
      updated_at = excluded.updated_at
  `)
    .bind(key, value, nowIso())
    .run();
}