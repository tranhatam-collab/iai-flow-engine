export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export function badRequest(message: string, details?: unknown): Response {
  return json(
    {
      ok: false,
      error: "bad_request",
      message,
      details: details ?? null,
    },
    { status: 400 },
  );
}

export function notFound(message = "Not found"): Response {
  return json(
    {
      ok: false,
      error: "not_found",
      message,
    },
    { status: 404 },
  );
}

export function methodNotAllowed(message = "Method not allowed"): Response {
  return json(
    {
      ok: false,
      error: "method_not_allowed",
      message,
    },
    { status: 405 },
  );
}

export function serverError(message = "Internal server error", details?: unknown): Response {
  return json(
    {
      ok: false,
      error: "server_error",
      message,
      details: details ?? null,
    },
    { status: 500 },
  );
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  headers.set("access-control-max-age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}