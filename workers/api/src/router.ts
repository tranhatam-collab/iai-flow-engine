import { json } from "./utils/json-response"

import { runtimeAPI } from "./api/runtime-api"
import { workflowAPI } from "./api/workflows-api"
import { runsAPI } from "./api/runs-api"
import { logsAPI } from "./api/logs-api"

export async function router(req: Request, env: Env, ctx: ExecutionContext) {

  const url = new URL(req.url)

  if (url.pathname === "/") {
    return json({
      service: "IAI Flow Engine",
      status: "running"
    })
  }

  if (url.pathname.startsWith("/api/runtime")) {
    return runtimeAPI(req, env)
  }

  if (url.pathname.startsWith("/api/workflows")) {
    return workflowAPI(req, env)
  }

  if (url.pathname.startsWith("/api/runs")) {
    return runsAPI(req, env)
  }

  if (url.pathname.startsWith("/api/logs")) {
    return logsAPI(req, env)
  }

  return json({ error: "not_found" }, 404)

}
