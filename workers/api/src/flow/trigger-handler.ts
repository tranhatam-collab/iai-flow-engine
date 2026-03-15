/* =========================================================
IAI FLOW ENGINE
Trigger Handler
Handles workflow triggers (webhook / manual / schedule)
========================================================= */

import type { Env } from "../index"
import { runFlowEngine } from "./flow-engine"



/* =========================================================
TYPES
========================================================= */

export interface TriggerPayload {

  flowId: string

  workspaceId: string

  userId: string

  triggerType: "webhook" | "manual" | "schedule" | "event"

  payload: Record<string, unknown>

}



/* =========================================================
MAIN ENTRY
========================================================= */

export async function handleTrigger(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {

  const url = new URL(req.url)

  if (req.method === "POST" && url.pathname.startsWith("/api/trigger/webhook")) {

    return handleWebhookTrigger(req, env)

  }

  if (req.method === "POST" && url.pathname.startsWith("/api/trigger/manual")) {

    return handleManualTrigger(req, env)

  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "trigger_not_supported"
    }),
    { status: 400 }
  )

}



/* =========================================================
WEBHOOK TRIGGER
========================================================= */

async function handleWebhookTrigger(
  req: Request,
  env: Env
): Promise<Response> {

  let body: any = {}

  try {

    body = await req.json()

  } catch {

    return new Response(
      JSON.stringify({
        ok: false,
        error: "invalid_json"
      }),
      { status: 400 }
    )

  }

  if (!body.flowId) {

    return new Response(
      JSON.stringify({
        ok: false,
        error: "missing_flow_id"
      }),
      { status: 400 }
    )

  }

  const result = await runFlowEngine({

    flowId: body.flowId,

    workspaceId: body.workspaceId || "default-workspace",

    userId: body.userId || "system",

    payload: body.payload || {},

    env

  })

  return new Response(
    JSON.stringify(result),
    { headers: { "content-type": "application/json" } }
  )

}



/* =========================================================
MANUAL TRIGGER
========================================================= */

async function handleManualTrigger(
  req: Request,
  env: Env
): Promise<Response> {

  let body: any = {}

  try {

    body = await req.json()

  } catch {

    return new Response(
      JSON.stringify({
        ok: false,
        error: "invalid_json"
      }),
      { status: 400 }
    )

  }

  if (!body.flowId) {

    return new Response(
      JSON.stringify({
        ok: false,
        error: "missing_flow_id"
      }),
      { status: 400 }
    )

  }

  const result = await runFlowEngine({

    flowId: body.flowId,

    workspaceId: body.workspaceId || "default-workspace",

    userId: body.userId || "manual-user",

    payload: body.payload || {},

    env

  })

  return new Response(
    JSON.stringify(result),
    { headers: { "content-type": "application/json" } }
  )

}



/* =========================================================
SCHEDULE TRIGGER
========================================================= */

export async function runScheduledTriggers(
  env: Env
) {

  const flows = await env.DB.prepare(`
    SELECT id
    FROM flows
    WHERE status = 'active'
  `).all()

  for (const row of flows.results || []) {

    await runFlowEngine({

      flowId: row.id,

      workspaceId: "system",

      userId: "scheduler",

      payload: {
        trigger: "schedule"
      },

      env

    })

  }

}
