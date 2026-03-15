import type { Env } from "../index";
import type { CurrentIdentity } from "./identity";

export interface AuditEventInput {
  eventType: string;
  resourceType: string;
  resourceId: string | null;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
}

export async function ensureAuditSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      event_type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      severity TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
  `).run();
}

export async function writeAuditLog(
  identity: CurrentIdentity,
  input: AuditEventInput,
  env: Env
): Promise<void> {
  await ensureAuditSchema(env);

  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO audit_logs (
      id,
      workspace_id,
      actor_user_id,
      actor_role,
      event_type,
      resource_type,
      resource_id,
      severity,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      identity.workspaceId,
      identity.userId,
      identity.role,
      input.eventType,
      input.resourceType,
      input.resourceId,
      input.severity || "info",
      JSON.stringify(input.metadata || {}),
      now
    )
    .run();
}

export async function listAuditLogs(
  workspaceId: string,
  env: Env
): Promise<Array<Record<string, unknown>>> {
  await ensureAuditSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      workspace_id,
      actor_user_id,
      actor_role,
      event_type,
      resource_type,
      resource_id,
      severity,
      metadata_json,
      created_at
    FROM audit_logs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT 200
  `)
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return (result.results || []).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    severity: row.severity,
    metadata: safeParseJson(row.metadata_json as string | null),
    createdAt: row.created_at
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
