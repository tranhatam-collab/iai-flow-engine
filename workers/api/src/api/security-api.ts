import type { Env } from "../index";
import {
  addWorkspaceMember,
  createWorkspace,
  listWorkspaceMembers,
  resolveCurrentIdentity,
  sanitizeRole
} from "../security/identity";
import { requirePermission } from "../security/permission";
import { createSecret, deleteSecret, listSecretsMetadata, rotateSecret } from "../security/secrets";
import { listAuditLogs, writeAuditLog } from "../security/audit";

export async function securityAPI(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/me" && method === "GET") {
    const identity = await resolveCurrentIdentity(request, env);

    return jsonResponse({
      ok: true,
      item: identity
    });
  }

  if (pathname === "/api/workspaces" && method === "POST") {
    const identity = await resolveCurrentIdentity(request, env);
    const body = await readJson<Record<string, unknown>>(request);
    const name = stringValue(body.name, "New Workspace");
    const slug = stringValue(body.slug, name);

    const workspace = await createWorkspace(name, slug, identity, env);

    await writeAuditLog(
      identity,
      {
        eventType: "workspace.created",
        resourceType: "workspace",
        resourceId: workspace.id as string,
        metadata: {
          name,
          slug
        }
      },
      env
    );

    return jsonResponse(
      {
        ok: true,
        item: workspace
      },
      { status: 201 }
    );
  }

  const membersMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  if (membersMatch && method === "GET") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "workspace.manage_members");

    return jsonResponse({
      ok: true,
      items: await listWorkspaceMembers(membersMatch[1], env)
    });
  }

  if (membersMatch && method === "POST") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "workspace.manage_members");

    const body = await readJson<Record<string, unknown>>(request);
    const member = await addWorkspaceMember(
      membersMatch[1],
      stringValue(body.email, ""),
      stringValue(body.displayName, stringValue(body.email, "")),
      sanitizeRole(body.role),
      env
    );

    await writeAuditLog(
      identity,
      {
        eventType: "membership.upserted",
        resourceType: "membership",
        resourceId: member.userId as string,
        metadata: {
          workspaceId: membersMatch[1],
          email: member.email,
          role: member.role
        }
      },
      env
    );

    return jsonResponse(
      {
        ok: true,
        item: member
      },
      { status: 201 }
    );
  }

  if (pathname === "/api/secrets" && method === "GET") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "secret.read_metadata");

    return jsonResponse({
      ok: true,
      items: await listSecretsMetadata(identity.workspaceId, env)
    });
  }

  if (pathname === "/api/secrets" && method === "POST") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "secret.create");

    const body = await readJson<Record<string, unknown>>(request);

    const secret = await createSecret(
      identity,
      stringValue(body.name, "unnamed-secret"),
      stringValue(body.type, "generic"),
      stringValue(body.value, ""),
      env
    );

    await writeAuditLog(
      identity,
      {
        eventType: "secret.created",
        resourceType: "secret",
        resourceId: secret.id as string,
        metadata: {
          name: secret.name,
          type: secret.type,
          last4: secret.last4
        }
      },
      env
    );

    return jsonResponse(
      {
        ok: true,
        item: secret
      },
      { status: 201 }
    );
  }

  const rotateMatch = pathname.match(/^\/api\/secrets\/([^/]+)\/rotate$/);
  if (rotateMatch && method === "POST") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "secret.rotate");

    const body = await readJson<Record<string, unknown>>(request);
    const rotated = await rotateSecret(
      identity,
      rotateMatch[1],
      stringValue(body.value, ""),
      env
    );

    if (!rotated) {
      return jsonResponse(
        {
          ok: false,
          error: "secret_not_found",
          message: "Secret not found"
        },
        { status: 404 }
      );
    }

    await writeAuditLog(
      identity,
      {
        eventType: "secret.rotated",
        resourceType: "secret",
        resourceId: rotateMatch[1],
        metadata: {
          keyVersion: rotated.keyVersion,
          last4: rotated.last4
        }
      },
      env
    );

    return jsonResponse({
      ok: true,
      item: rotated
    });
  }

  const secretMatch = pathname.match(/^\/api\/secrets\/([^/]+)$/);
  if (secretMatch && method === "DELETE") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "secret.delete");

    const deleted = await deleteSecret(identity, secretMatch[1], env);

    await writeAuditLog(
      identity,
      {
        eventType: "secret.deleted",
        resourceType: "secret",
        resourceId: secretMatch[1],
        metadata: {
          deleted
        }
      },
      env
    );

    return jsonResponse({
      ok: true,
      deleted
    });
  }

  if (pathname === "/api/audit" && method === "GET") {
    const identity = await resolveCurrentIdentity(request, env);
    requirePermission(identity, "audit.read");

    return jsonResponse({
      ok: true,
      items: await listAuditLogs(identity.workspaceId, env)
    });
  }

  return null;
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {} as T;
  }
  return (await request.json()) as T;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
  headers.set("access-control-allow-headers", "content-type, authorization, x-user-id, x-workspace-id, x-internal-api-key");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}
