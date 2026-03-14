import { json } from "../utils/json-response"

export async function runtimeAPI(req: Request, env: Env) {
  return json({
    ok: true,
    message: "runtime api ready"
  })
}
