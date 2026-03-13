import { Env } from "../lib/db";

export class ExecutionCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS coordinator_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      )
    `);

    if (request.method === "POST" && url.pathname === "/start") {
      const body = await request.json<{
        runId: string;
        workflowId?: string | null;
        workflowName: string;
      }>();

      await this.ctx.storage.sql.exec(
        `INSERT INTO coordinator_events (run_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
        body.runId,
        "start",
        JSON.stringify(body),
        new Date().toISOString(),
      );

      return new Response(
        JSON.stringify({ ok: true, event: "start_recorded" }),
        { headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    if (request.method === "POST" && url.pathname === "/event") {
      const body = await request.json<{
        runId: string;
        eventType: string;
        payload?: unknown;
      }>();

      await this.ctx.storage.sql.exec(
        `INSERT INTO coordinator_events (run_id, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?)`,
        body.runId,
        body.eventType,
        JSON.stringify(body.payload ?? null),
        new Date().toISOString(),
      );

      return new Response(
        JSON.stringify({ ok: true, event: "event_recorded" }),
        { headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    if (request.method === "GET" && url.pathname === "/events") {
      const rows = [
        ...this.ctx.storage.sql.exec(
          `SELECT id, run_id, event_type, payload_json, created_at
           FROM coordinator_events
           ORDER BY id DESC
           LIMIT 100`,
        ),
      ];

      return new Response(JSON.stringify({ ok: true, items: rows }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(
      JSON.stringify({ ok: false, error: "not_found" }),
      {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }
}