/* =========================================================
IAI FLOW ENGINE
Node Runner
Executes individual workflow nodes
Compatible with Cloudflare Workers runtime
========================================================= */

export interface FlowNode {

  id: string

  type: string

  name?: string

  config?: Record<string, any>

}

export interface NodeExecutionContext {

  workspaceId: string

  userId: string

  executionId: string

  input: any

  env?: any

}

export interface NodeExecutionResult {

  success: boolean

  output?: any

  error?: string

}



/* =========================================================
NODE REGISTRY
========================================================= */

type NodeExecutor = (
  node: FlowNode,
  ctx: NodeExecutionContext
) => Promise<NodeExecutionResult>


const registry = new Map<string, NodeExecutor>()



export function registerNode(
  type: string,
  executor: NodeExecutor
) {

  registry.set(type, executor)

}



/* =========================================================
RUN NODE
========================================================= */

export async function runNode(
  node: FlowNode,
  ctx: NodeExecutionContext
): Promise<NodeExecutionResult> {

  const executor = registry.get(node.type)

  if (!executor) {

    return {
      success: false,
      error: "node type not supported: " + node.type
    }

  }

  try {

    const result = await executor(node, ctx)

    return result

  } catch (err: any) {

    return {
      success: false,
      error: err?.message || "node execution failed"
    }

  }

}



/* =========================================================
BUILT-IN NODES
========================================================= */


/* ---------- LOG NODE ---------- */

registerNode(
  "log",
  async (node, ctx) => {

    console.log(
      "[FLOW LOG]",
      node.name || node.id,
      ctx.input
    )

    return {
      success: true,
      output: ctx.input
    }

  }
)



/* ---------- SET NODE ---------- */

registerNode(
  "set",
  async (node, ctx) => {

    const value = node.config?.value

    return {
      success: true,
      output: value
    }

  }
)



/* ---------- TRANSFORM NODE ---------- */

registerNode(
  "transform",
  async (node, ctx) => {

    const template = node.config?.template

    if (!template) {

      return {
        success: false,
        error: "transform node missing template"
      }

    }

    const output = template
      .replace(/\{\{input\}\}/g, JSON.stringify(ctx.input))

    return {
      success: true,
      output
    }

  }
)



/* ---------- HTTP REQUEST NODE ---------- */

registerNode(
  "http",
  async (node, ctx) => {

    const url = node.config?.url

    const method = node.config?.method || "GET"

    if (!url) {

      return {
        success: false,
        error: "missing url"
      }

    }

    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json"
      },
      body: method !== "GET"
        ? JSON.stringify(ctx.input)
        : undefined
    })

    const text = await res.text()

    return {
      success: true,
      output: text
    }

  }
)



/* ---------- CONDITION NODE ---------- */

registerNode(
  "if",
  async (node, ctx) => {

    const key = node.config?.key

    const value = node.config?.value

    if (!key) {

      return {
        success: false,
        error: "missing condition key"
      }

    }

    const pass = ctx.input?.[key] === value

    return {
      success: true,
      output: {
        pass
      }
    }

  }
)



/* =========================================================
UTILITY
========================================================= */

export function listNodeTypes(): string[] {

  return Array.from(registry.keys())

}
