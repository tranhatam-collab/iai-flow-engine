import { getNode } from "../nodes/node-registry"

export async function runNode(node, context) {

  const nodeImpl = getNode(node.type)

  if (!nodeImpl) {
    throw new Error("Node not registered")
  }

  const result = await nodeImpl.execute(node, context)

  return result

}
