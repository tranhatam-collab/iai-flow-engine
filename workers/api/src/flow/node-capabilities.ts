/* =========================================================
IAI FLOW ENGINE
Node Capabilities
Defines node metadata, permissions, schemas and runtime traits
========================================================= */

export type NodeCategory =
  | "trigger"
  | "logic"
  | "transform"
  | "integration"
  | "runtime"
  | "ai"
  | "storage"
  | "security"
  | "utility";

export type WorkspaceRole =
  | "owner"
  | "admin"
  | "builder"
  | "operator"
  | "analyst"
  | "viewer";

export interface NodeFieldSchema {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "json" | "select";
  required: boolean;
  description?: string;
  options?: string[];
  defaultValue?: unknown;
}

export interface NodeIOShape {
  input: string[];
  output: string[];
}

export interface NodeSecurityProfile {
  requiresSecret: boolean;
  secretTypes?: string[];
  allowsNetwork: boolean;
  allowsStorageWrite: boolean;
  allowsRuntimeMutation: boolean;
}

export interface NodeCapability {
  type: string;
  displayName: string;
  description: string;
  category: NodeCategory;
  stable: boolean;
  version: string;
  rolesAllowed: WorkspaceRole[];
  configSchema: NodeFieldSchema[];
  io: NodeIOShape;
  security: NodeSecurityProfile;
  tags: string[];
}

const NODE_CAPABILITIES: Record<string, NodeCapability> = {
  trigger: {
    type: "trigger",
    displayName: "Trigger",
    description: "Starts a workflow with external or internal input.",
    category: "trigger",
    stable: true,
    version: "1.0.0",
    rolesAllowed: ["owner", "admin", "builder", "operator"],
    configSchema: [
      {
        key: "source",
        label: "Source",
        type: "select",
        required: false,
        options: ["manual", "webhook", "schedule", "event"],
        defaultValue: "manual",
        description: "Defines how the workflow is triggered."
      }
    ],
    io: {
      input: [],
      output: ["payload", "metadata"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: false,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["entry", "start", "event"]
  },

  log: {
    type: "log",
    displayName: "Log",
    description: "Writes debug information into runtime output and execution trace.",
    category: "utility",
    stable: true,
    version: "1.0.0",
    rolesAllowed: ["owner", "admin", "builder", "operator", "analyst", "viewer"],
    configSchema: [],
    io: {
      input: ["any"],
      output: ["same_as_input"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: false,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["debug", "trace", "output"]
  },

  set: {
    type: "set",
    displayName: "Set Value",
    description: "Sets a static value or object into workflow payload.",
    category: "transform",
    stable: true,
    version: "1.0.0",
    rolesAllowed: ["owner", "admin", "builder"],
    configSchema: [
      {
        key: "value",
        label: "Value",
        type: "json",
        required: true,
        description: "Static value assigned by this node."
      }
    ],
    io: {
      input: ["any"],
      output: ["value"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: false,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["assign", "static", "payload"]
  },

  transform: {
    type: "transform",
    displayName: "Transform",
    description: "Transforms incoming payload into a new output using templates.",
    category: "transform",
    stable: true,
    version: "1.0.0",
    rolesAllowed: ["owner", "admin", "builder"],
    configSchema: [
      {
        key: "template",
        label: "Template",
        type: "string",
        required: true,
        description: "String template that can reference {{input}}."
      }
    ],
    io: {
      input: ["any"],
      output: ["string", "json"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: false,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["map", "template", "format"]
  },

  if: {
    type: "if",
    displayName: "Condition",
    description: "Branches execution based on an input condition.",
    category: "logic",
    stable: true,
    version: "1.0.0",
    rolesAllowed: ["owner", "admin", "builder", "operator"],
    configSchema: [
      {
        key: "key",
        label: "Input Key",
        type: "string",
        required: true,
        description: "Field name in input payload."
      },
      {
        key: "value",
        label: "Expected Value",
        type: "string",
        required: true,
        description: "Value to compare against input payload."
      }
    ],
    io: {
      input: ["json"],
      output: ["{ pass: boolean }"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: false,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["branch", "condition", "logic"]
  },

  http: {
    type: "http",
    displayName: "HTTP Request",
    description: "Calls an external HTTP endpoint with the current payload.",
    category: "integration",
    stable: true,
    version: "1.0.0",
    rolesAllowed: ["owner", "admin", "builder", "operator"],
    configSchema: [
      {
        key: "url",
        label: "URL",
        type: "string",
        required: true,
        description: "Absolute endpoint URL."
      },
      {
        key: "method",
        label: "Method",
        type: "select",
        required: false,
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        defaultValue: "GET",
        description: "HTTP request method."
      }
    ],
    io: {
      input: ["json", "text"],
      output: ["text", "json"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: true,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["api", "fetch", "network"]
  },

  runtime: {
    type: "runtime",
    displayName: "Runtime Control",
    description: "Interacts with internal runtime state and orchestration metadata.",
    category: "runtime",
    stable: false,
    version: "0.9.0",
    rolesAllowed: ["owner", "admin", "operator"],
    configSchema: [
      {
        key: "action",
        label: "Action",
        type: "select",
        required: true,
        options: ["checkpoint", "mark", "inspect"],
        defaultValue: "inspect",
        description: "Runtime interaction action."
      }
    ],
    io: {
      input: ["any"],
      output: ["runtime_state"]
    },
    security: {
      requiresSecret: false,
      allowsNetwork: false,
      allowsStorageWrite: false,
      allowsRuntimeMutation: true
    },
    tags: ["runtime", "inspect", "orchestration"]
  },

  agent: {
    type: "agent",
    displayName: "AI Agent",
    description: "Runs an AI-oriented decision or content generation step.",
    category: "ai",
    stable: false,
    version: "0.9.0",
    rolesAllowed: ["owner", "admin", "builder"],
    configSchema: [
      {
        key: "model",
        label: "Model",
        type: "string",
        required: true,
        description: "Configured AI model identifier."
      },
      {
        key: "instruction",
        label: "Instruction",
        type: "string",
        required: true,
        description: "High-level task instruction for the agent."
      }
    ],
    io: {
      input: ["json", "text"],
      output: ["text", "json"]
    },
    security: {
      requiresSecret: true,
      secretTypes: ["api_key", "oauth_token"],
      allowsNetwork: true,
      allowsStorageWrite: false,
      allowsRuntimeMutation: false
    },
    tags: ["llm", "ai", "assistant"]
  }
};

/* =========================================================
PUBLIC API
========================================================= */

export function listNodeCapabilities(): NodeCapability[] {
  return Object.values(NODE_CAPABILITIES).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
}

export function getNodeCapability(type: string): NodeCapability | null {
  return NODE_CAPABILITIES[type] || null;
}

export function nodeExists(type: string): boolean {
  return !!NODE_CAPABILITIES[type];
}

export function isNodeAllowedForRole(
  type: string,
  role: WorkspaceRole
): boolean {
  const capability = getNodeCapability(type);

  if (!capability) return false;

  return capability.rolesAllowed.includes(role);
}

export function nodeRequiresSecret(type: string): boolean {
  const capability = getNodeCapability(type);

  if (!capability) return false;

  return capability.security.requiresSecret;
}

export function validateNodeConfig(
  type: string,
  config: Record<string, unknown> | undefined
): { ok: true } | { ok: false; error: string } {
  const capability = getNodeCapability(type);

  if (!capability) {
    return {
      ok: false,
      error: `Unknown node type: ${type}`
    };
  }

  const safeConfig = isRecord(config) ? config : {};

  for (const field of capability.configSchema) {
    const value = safeConfig[field.key];

    if (field.required && isMissing(value)) {
      return {
        ok: false,
        error: `Missing required config field: ${field.key}`
      };
    }

    if (!isMissing(value) && !matchesFieldType(value, field.type, field.options)) {
      return {
        ok: false,
        error: `Invalid type for config field: ${field.key}`
      };
    }
  }

  return { ok: true };
}

/* =========================================================
UTILS
========================================================= */

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function matchesFieldType(
  value: unknown,
  type: NodeFieldSchema["type"],
  options?: string[]
): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";

    case "number":
      return typeof value === "number" && Number.isFinite(value);

    case "boolean":
      return typeof value === "boolean";

    case "json":
      return true;

    case "select":
      return typeof value === "string" && (!!options ? options.includes(value) : true);

    default:
      return false;
  }
}
