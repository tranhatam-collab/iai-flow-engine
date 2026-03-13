import { loadWorkflow } from "./workflow-loader"
import { validateWorkflow } from "./workflow-validator"
import { buildGraph } from "./execution-graph"
import { runNode } from "./node-runner"

export async function runWorkflow(workflowId: string, env: Env) {

  const workflow = await loadWorkflow(workflowId)

  validateWorkflow(workflow)

  const graph = buildGraph(workflow)

  const results = {}

  for (const node of graph.executionOrder) {

    const result = await runNode(node, results)

    results[node.id] = result

  }

  return results

}
