/* =========================================================
IAI FLOW ENGINE
Node Catalog API
Production-ready node catalog for builder/frontend
========================================================= */

import type { Env } from "../index";
import { resolveCurrentIdentity } from "../security/identity";
import { requirePermission } from "../security/permission";
import {
  getNodeCapability,
  listNodeCapabilities
} from "../flow/node-capabilities";

export async function nodeCatalogAPI(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (pathname === "/api/node-catalog" && method === "GET") {
    return listCatalog(request, env, url);
  }

  const match = pathname.match(/^\/api\/node-catalog\/([^/]+)$/);
  if (match && method === "GET") {
    return getCatalogItem(match[1], request, env);
  }

  return null;
}

async function listCatalog(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  const category = (url.searchParams.get("category") || "").trim().toLowerCase();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const stableOnly = url.searchParams.get("stable") === "true";

  let items = listNodeCapabilities();

  items = items.filter((item) => item.rolesAllowed.includes(identity.role));

  if (category) {
    items = items.filter((item) => item.category === category);
  }

  if (stableOnly) {
    items = items.filter((item) => item.stable);
  }

  if (q) {
    items = items.filter((item) => {
      return (
        item.type.toLowerCase().includes(q) ||
        item.displayName.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }

  return jsonResponse({
    ok: true,
    items,
    filters: {
      category: category || null,
      q: q || null,
      stable: stableOnly
    }
  });
}

async function getCatalogItem(
  type: string,
  request: Request,
  env: Env
): Promise<Response> {
  const identity = await resolveCurrentIdentity(request, env);
  requirePermission(identity, "flow.read");

  const item = getNodeCapability(type);

  if (!item) {
    return jsonResponse(
      {
        ok: false,
        error: "node_not_found",
        message: "Node catalog item not found"
      },
      { status: 404 }
    );
  }

  if (!item.rolesAllowed.includes(identity.role)) {
    return jsonResponse(
      {
        ok: false,
        error: "node_forbidden",
        message: "Current role is not allowed to use this node"
      },
      { status: 403 }
    );
  }

  return jsonResponse({
    ok: true,
    item
  });
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
