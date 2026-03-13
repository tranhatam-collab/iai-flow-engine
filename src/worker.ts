export interface Env {
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_ENV: string;
}

const HTML_ROUTES = new Set([
  "/",
  "/docs",
  "/modules",
  "/nodes",
  "/developers",
  "/investor",
  "/app",
  "/app/dashboard",
  "/app/workflows",
  "/app/workflows/builder",
  "/app/agents",
  "/app/nodes",
  "/app/runtime",
  "/app/logs",
  "/app/settings",
  "/docs/architecture"
]);

const EXACT_FILE_ROUTES = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/icon.png",
  "/favicon.ico"
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const normalizedPath = normalizePath(url.pathname);

    if (normalizedPath === "/health") {
      return jsonResponse({
        ok: true,
        app: env.APP_NAME,
        env: env.APP_ENV,
        path: normalizedPath
      });
    }

    if (normalizedPath === "/api/status") {
      return jsonResponse({
        ok: true,
        service: "flow.iai.one router",
        app: env.APP_NAME,
        env: env.APP_ENV
      });
    }

    const assetRequest = buildAssetRequest(request, url, normalizedPath);
    const assetResponse = await env.ASSETS.fetch(assetRequest);

    if (assetResponse.status !== 404) {
      return withSecurityHeaders(assetResponse, normalizedPath);
    }

    if (looksLikeHtmlRoute(normalizedPath)) {
      const fallbackRequest = new Request(
        new URL("/index.html", url.origin).toString(),
        request
      );
      const fallbackResponse = await env.ASSETS.fetch(fallbackRequest);

      if (fallbackResponse.status !== 404) {
        return withSecurityHeaders(fallbackResponse, "/index.html");
      }
    }

    return withSecurityHeaders(
      new Response("Not Found", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      }),
      normalizedPath
    );
  }
};

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function buildAssetRequest(
  request: Request,
  url: URL,
  normalizedPath: string
): Request {
  let assetPath = normalizedPath;

  if (EXACT_FILE_ROUTES.has(normalizedPath)) {
    assetPath = normalizedPath;
  } else if (HTML_ROUTES.has(normalizedPath)) {
    assetPath = normalizedPath === "/" ? "/index.html" : `${normalizedPath}/index.html`;
  } else if (hasFileExtension(normalizedPath)) {
    assetPath = normalizedPath;
  } else {
    assetPath = `${normalizedPath}/index.html`;
  }

  const assetUrl = new URL(assetPath, url.origin);
  return new Request(assetUrl.toString(), request);
}

function hasFileExtension(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() || "";
  return lastSegment.includes(".");
}

function looksLikeHtmlRoute(pathname: string): boolean {
  return !hasFileExtension(pathname);
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  applyCors(headers);

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

function withSecurityHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);

  applyCors(headers);

  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://api.flow.iai.one http://localhost:8787",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'"
    ].join("; ")
  );

  if (pathname.endsWith(".html") || pathname === "/" || looksLikeHtmlRoute(pathname)) {
    headers.set("cache-control", "public, max-age=300");
  } else if (
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".ico")
  ) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else {
    headers.set("cache-control", "public, max-age=600");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function corsHeaders(): HeadersInit {
  const headers = new Headers();
  applyCors(headers);
  return headers;
}

function applyCors(headers: Headers): void {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
}
