const registry = new Map()

export function registerNode(type, module) {
  registry.set(type, module)
}

export function getNode(type) {
  return registry.get(type)
}
