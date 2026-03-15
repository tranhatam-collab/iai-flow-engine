export interface GuardResult {
  ok: boolean
  reason?: string
}

const BLOCK_PATTERNS = [

  "ignore previous instructions",

  "system prompt",

  "reveal hidden prompt",

  "bypass policy",

  "jailbreak",

  "developer mode"

]

export function guardPrompt(input: string): GuardResult {

  const lower = input.toLowerCase()

  for (const p of BLOCK_PATTERNS) {

    if (lower.includes(p)) {

      return {
        ok: false,
        reason: "prompt injection detected"
      }

    }

  }

  if (input.length > 20000) {

    return {
      ok: false,
      reason: "input too large"
    }

  }

  return { ok: true }

}

export function guardJSON(data: unknown): GuardResult {

  try {

    JSON.stringify(data)

    return { ok: true }

  } catch {

    return {
      ok: false,
      reason: "invalid json payload"
    }

  }

}
