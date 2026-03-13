import { router } from "./router"
import { ExecutionCoordinator } from "./coordinator/execution-coordinator"

export { ExecutionCoordinator }

export default {

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return router(request, env, ctx)
  }

}
