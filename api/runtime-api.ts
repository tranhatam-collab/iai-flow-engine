import { json } from "../utils/json-response"
import { runWorkflow } from "../runtime/runtime-engine"

export async function runtimeAPI(req: Request, env: Env) {

  if (req.method === "POST") {

    const body = await req.json()

    const result = await runWorkflow(body.workflowId, env)

    return json({
      success: true,
      result
    })

  }

  return json({ error: "invalid_request" }, 400)

}
