import type { Env } from "../index";

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "builder"
  | "operator"
  | "analyst"
  | "viewer";

export interface CurrentIdentity {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  displayName: string;
  email: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function ensureIdentitySchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      owner_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, user_id)
    )
  `).run();
}

export async function resolveCurrentIdentity(request: Request, env: Env): Promise<CurrentIdentity> {
  await ensureIdentitySchema(env);

  const headerUserId = (request.headers.get("x-user-id") || "").trim();
  const headerWorkspaceId = (request.headers.get("x-workspace-id") || "").trim();

  const userId = headerUserId || "demo-user";
  const workspaceId = headerWorkspaceId || "demo-workspace";

  await ensureBootstrapIdentity(userId, workspaceId, env);

  const user = await env.DB.prepare(`
    SELECT id, email, display_name, status, created_at, updated_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `)
    .bind(userId)
    .first<UserRow>();

  if (!user || user.status !== "active") {
    throw new Error("Active user not found");
  }

  const membership = await env.DB.prepare(`
    SELECT id, workspace_id, user_id, role, status, created_at, updated_at
    FROM memberships
    WHERE workspace_id = ? AND user_id = ?
    LIMIT 1
  `)
    .bind(workspaceId, userId)
    .first<MembershipRow>();

  if (!membership || membership.status !== "active") {
    throw new Error("Active membership not found");
  }

  return {
    userId: user.id,
    workspaceId,
    role: membership.role,
    displayName: user.display_name,
    email: user.email
  };
}

export async function ensureBootstrapIdentity(
  userId: string,
  workspaceId: string,
  env: Env
): Promise<void> {
  const now = new Date().toISOString();

  const user = await env.DB.prepare(`
    SELECT id
    FROM users
    WHERE id = ?
    LIMIT 1
  `)
    .bind(userId)
    .first<UserRow>();

  if (!user) {
    await env.DB.prepare(`
      INSERT INTO users (
        id,
        email,
        display_name,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?)
    `)
      .bind(
        userId,
        `${userId}@iai-flow.local`,
        userId === "demo-user" ? "Demo User" : `User ${userId}`,
        now,
        now
      )
      .run();
  }

  const workspace = await env.DB.prepare(`
    SELECT id
    FROM workspaces
    WHERE id = ?
    LIMIT 1
  `)
    .bind(workspaceId)
    .first<WorkspaceRow>();

  if (!workspace) {
    await env.DB.prepare(`
      INSERT INTO workspaces (
        id,
        name,
        slug,
        status,
        owner_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?)
    `)
      .bind(
        workspaceId,
        workspaceId === "demo-workspace" ? "Demo Workspace" : `Workspace ${workspaceId}`,
        slugify(workspaceId),
        userId,
        now,
        now
      )
      .run();
  }

  const membership = await env.DB.prepare(`
    SELECT id
    FROM memberships
    WHERE workspace_id = ? AND user_id = ?
    LIMIT 1
  `)
    .bind(workspaceId, userId)
    .first<MembershipRow>();

  if (!membership) {
    await env.DB.prepare(`
      INSERT INTO memberships (
        id,
        workspace_id,
        user_id,
        role,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'owner', 'active', ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        workspaceId,
        userId,
        now,
        now
      )
      .run();
  }
}

export async function listWorkspaceMembers(
  workspaceId: string,
  env: Env
): Promise<Array<Record<string, unknown>>> {
  await ensureIdentitySchema(env);

  const result = await env.DB.prepare(`
    SELECT
      memberships.id,
      memberships.workspace_id,
      memberships.user_id,
      memberships.role,
      memberships.status,
      memberships.created_at,
      memberships.updated_at,
      users.email,
      users.display_name
    FROM memberships
    INNER JOIN users ON users.id = memberships.user_id
    WHERE memberships.workspace_id = ?
    ORDER BY memberships.created_at ASC
  `)
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return (result.results || []).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function createWorkspace(
  name: string,
  slug: string,
  identity: CurrentIdentity,
  env: Env
): Promise<Record<string, unknown>> {
  await ensureIdentitySchema(env);

  const now = new Date().toISOString();
  const workspaceId = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO workspaces (
      id,
      name,
      slug,
      status,
      owner_user_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?)
  `)
    .bind(
      workspaceId,
      name,
      slugify(slug),
      identity.userId,
      now,
      now
    )
    .run();

  await env.DB.prepare(`
    INSERT INTO memberships (
      id,
      workspace_id,
      user_id,
      role,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'owner', 'active', ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      workspaceId,
      identity.userId,
      now,
      now
    )
    .run();

  return {
    id: workspaceId,
    name,
    slug: slugify(slug),
    ownerUserId: identity.userId,
    createdAt: now,
    updatedAt: now
  };
}

export async function addWorkspaceMember(
  workspaceId: string,
  email: string,
  displayName: string,
  role: WorkspaceRole,
  env: Env
): Promise<Record<string, unknown>> {
  await ensureIdentitySchema(env);

  const now = new Date().toISOString();
  let user = await env.DB.prepare(`
    SELECT id, email, display_name, status, created_at, updated_at
    FROM users
    WHERE email = ?
    LIMIT 1
  `)
    .bind(email.trim().toLowerCase())
    .first<UserRow>();

  if (!user) {
    const userId = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO users (
        id,
        email,
        display_name,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?)
    `)
      .bind(
        userId,
        email.trim().toLowerCase(),
        displayName.trim() || email.trim().toLowerCase(),
        now,
        now
      )
      .run();

    user = {
      id: userId,
      email: email.trim().toLowerCase(),
      display_name: displayName.trim() || email.trim().toLowerCase(),
      status: "active",
      created_at: now,
      updated_at: now
    };
  }

  await env.DB.prepare(`
    INSERT OR REPLACE INTO memberships (
      id,
      workspace_id,
      user_id,
      role,
      status,
      created_at,
      updated_at
    ) VALUES (
      COALESCE(
        (SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1),
        ?
      ),
      ?, ?, ?, 'active', ?, ?
    )
  `)
    .bind(
      workspaceId,
      user.id,
      crypto.randomUUID(),
      workspaceId,
      user.id,
      sanitizeRole(role),
      now,
      now
    )
    .run();

  return {
    workspaceId,
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    role: sanitizeRole(role),
    updatedAt: now
  };
}

export function sanitizeRole(value: unknown): WorkspaceRole {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    role === "owner" ||
    role === "admin" ||
    role === "builder" ||
    role === "operator" ||
    role === "analyst" ||
    role === "viewer"
  ) {
    return role;
  }

  return "viewer";
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `workspace-${crypto.randomUUID().slice(0, 8)}`;
}
