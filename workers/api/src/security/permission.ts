import type { CurrentIdentity, WorkspaceRole } from "./identity";

type PermissionAction =
  | "workspace.read"
  | "workspace.manage_members"
  | "flow.read"
  | "flow.create"
  | "flow.update"
  | "flow.delete"
  | "flow.run"
  | "execution.read"
  | "secret.read_metadata"
  | "secret.create"
  | "secret.rotate"
  | "secret.delete"
  | "audit.read";

const ROLE_PERMISSIONS: Record<WorkspaceRole, PermissionAction[]> = {
  owner: [
    "workspace.read",
    "workspace.manage_members",
    "flow.read",
    "flow.create",
    "flow.update",
    "flow.delete",
    "flow.run",
    "execution.read",
    "secret.read_metadata",
    "secret.create",
    "secret.rotate",
    "secret.delete",
    "audit.read"
  ],
  admin: [
    "workspace.read",
    "workspace.manage_members",
    "flow.read",
    "flow.create",
    "flow.update",
    "flow.delete",
    "flow.run",
    "execution.read",
    "secret.read_metadata",
    "secret.create",
    "secret.rotate",
    "secret.delete",
    "audit.read"
  ],
  builder: [
    "workspace.read",
    "flow.read",
    "flow.create",
    "flow.update",
    "flow.run",
    "execution.read",
    "secret.read_metadata"
  ],
  operator: [
    "workspace.read",
    "flow.read",
    "flow.run",
    "execution.read",
    "secret.read_metadata"
  ],
  analyst: [
    "workspace.read",
    "flow.read",
    "execution.read",
    "audit.read"
  ],
  viewer: [
    "workspace.read",
    "flow.read"
  ]
};

export function hasPermission(
  identity: CurrentIdentity,
  action: PermissionAction
): boolean {
  return ROLE_PERMISSIONS[identity.role].includes(action);
}

export function requirePermission(
  identity: CurrentIdentity,
  action: PermissionAction
): void {
  if (!hasPermission(identity, action)) {
    throw new Error(`Permission denied for action: ${action}`);
  }
}

export type { PermissionAction };
