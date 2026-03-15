export interface RateLimitState {
  count: number
  resetAt: number
}

const WINDOW = 60 * 1000
const LIMIT = 120

const memory = new Map<string, RateLimitState>()

export function checkRateLimit(
  key: string
): boolean {

  const now = Date.now()

  let state = memory.get(key)

  if (!state) {

    memory.set(key, {
      count: 1,
      resetAt: now + WINDOW
    })

    return true

  }

  if (now > state.resetAt) {

    memory.set(key, {
      count: 1,
      resetAt: now + WINDOW
    })

    return true

  }

  if (state.count >= LIMIT) {

    return false

  }

  state.count++

  return true
}

export function getClientIP(req: Request): string {

  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-forwarded-for")
    || "unknown"

}
