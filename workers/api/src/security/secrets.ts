import type { Env } from "../index";
import type { CurrentIdentity } from "./identity";

interface SecretRow {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  ciphertext: string;
  key_version: string;
  last4: string | null;
  created_by: string;
  created_at: string;
  rotated_at: string | null;
  updated_at: string;
}

export async function ensureSecretsSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      key_version TEXT NOT NULL,
      last4 TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      rotated_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, name)
    )
  `).run();
}

export async function listSecretsMetadata(
  workspaceId: string,
  env: Env
): Promise<Array<Record<string, unknown>>> {
  await ensureSecretsSchema(env);

  const result = await env.DB.prepare(`
    SELECT
      id,
      workspace_id,
      name,
      type,
      key_version,
      last4,
      created_by,
      created_at,
      rotated_at,
      updated_at
    FROM secrets
    WHERE workspace_id = ?
    ORDER BY updated_at DESC
  `)
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return (result.results || []).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    keyVersion: row.key_version,
    last4: row.last4,
    createdBy: row.created_by,
    createdAt: row.created_at,
    rotatedAt: row.rotated_at,
    updatedAt: row.updated_at
  }));
}

export async function createSecret(
  identity: CurrentIdentity,
  name: string,
  type: string,
  plaintext: string,
  env: Env
): Promise<Record<string, unknown>> {
  await ensureSecretsSchema(env);

  const now = new Date().toISOString();
  const secretId = crypto.randomUUID();
  const ciphertext = await encryptSecret(plaintext, env.FLOW_RUNTIME_SECRET);
  const last4 = plaintext.slice(-4) || null;

  await env.DB.prepare(`
    INSERT INTO secrets (
      id,
      workspace_id,
      name,
      type,
      ciphertext,
      key_version,
      last4,
      created_by,
      created_at,
      rotated_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      secretId,
      identity.workspaceId,
      name.trim(),
      type.trim() || "generic",
      ciphertext,
      "v1",
      last4,
      identity.userId,
      now,
      null,
      now
    )
    .run();

  return {
    id: secretId,
    workspaceId: identity.workspaceId,
    name: name.trim(),
    type: type.trim() || "generic",
    keyVersion: "v1",
    last4,
    createdBy: identity.userId,
    createdAt: now,
    updatedAt: now
  };
}

export async function rotateSecret(
  identity: CurrentIdentity,
  secretId: string,
  plaintext: string,
  env: Env
): Promise<Record<string, unknown> | null> {
  await ensureSecretsSchema(env);

  const existing = await env.DB.prepare(`
    SELECT
      id,
      workspace_id,
      name,
      type,
      ciphertext,
      key_version,
      last4,
      created_by,
      created_at,
      rotated_at,
      updated_at
    FROM secrets
    WHERE id = ? AND workspace_id = ?
    LIMIT 1
  `)
    .bind(secretId, identity.workspaceId)
    .first<SecretRow>();

  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const ciphertext = await encryptSecret(plaintext, env.FLOW_RUNTIME_SECRET);
  const last4 = plaintext.slice(-4) || null;

  await env.DB.prepare(`
    UPDATE secrets
    SET ciphertext = ?, key_version = ?, last4 = ?, rotated_at = ?, updated_at = ?
    WHERE id = ?
  `)
    .bind(
      ciphertext,
      "v2",
      last4,
      now,
      now,
      secretId
    )
    .run();

  return {
    id: secretId,
    workspaceId: identity.workspaceId,
    name: existing.name,
    type: existing.type,
    keyVersion: "v2",
    last4,
    rotatedAt: now,
    updatedAt: now
  };
}

export async function deleteSecret(
  identity: CurrentIdentity,
  secretId: string,
  env: Env
): Promise<boolean> {
  await ensureSecretsSchema(env);

  const result = await env.DB.prepare(`
    DELETE FROM secrets
    WHERE id = ? AND workspace_id = ?
  `)
    .bind(secretId, identity.workspaceId)
    .run();

  return !!result.success;
}

async function encryptSecret(plaintext: string, masterSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(masterSecret)
  );

  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
