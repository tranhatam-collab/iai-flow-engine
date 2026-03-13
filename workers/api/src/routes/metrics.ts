import { json, methodNotAllowed, serverError } from "../lib/json";
import { Env, nowIso } from "../lib/db";

export async function handleMetrics(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method === "GET") {
      const result = await env.DB.prepare(`
        SELECT key, value_text, updated_at
        FROM runtime_metrics
      `).all<{ key: string; value_text: string; updated_at: string }>();

      const item: Record<string, string> = {};
      for (const row of result.results ?? []) {
        item[row.key] = row.value_text;
      }

      return json({
        ok: true,
        item,
      });
    }

    if (request.method === "POST") {
      const body = await request.json<Record<string, string>>();

      for (const [key, value] of Object.entries(body)) {
        await env.DB.prepare(`
          INSERT INTO runtime_metrics (key, value_text, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_text = excluded.value_text,
            updated_at = excluded.updated_at
        `)
          .bind(key, String(value), nowIso())
          .run();
      }

      return json({
        ok: true,
        message: "Metrics updated",
      });
    }

    return methodNotAllowed("Unsupported metrics route");
  } catch (error) {
    return serverError("Metrics route failed", String(error));
  }
}