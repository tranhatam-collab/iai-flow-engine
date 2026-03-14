import { json } from "../utils/json-response"

export async function workflowAPI(req: Request, env: Env) {
  return json({
    ok: true,
    message: "workflows api ready"
  })
}
