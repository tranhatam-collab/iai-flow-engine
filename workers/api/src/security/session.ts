export interface Session {
  id: string
  userId: string
  email: string
  role: string
  createdAt: number
  expiresAt: number
}

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7

export async function createSession(user: {
  id: string
  email: string
  role: string
}): Promise<Session> {
  const id = crypto.randomUUID()

  const now = Date.now()

  return {
    id,
    userId: user.id,
    email: user.email,
    role: user.role,
    createdAt: now,
    expiresAt: now + SESSION_TTL
  }
}

export function parseAuthHeader(req: Request): string | null {
  const auth = req.headers.get("authorization")

  if (!auth) return null

  const parts = auth.split(" ")

  if (parts.length !== 2) return null

  if (parts[0] !== "Bearer") return null

  return parts[1]
}

export async function validateSession(
  token: string
): Promise<Session | null> {

  try {

    const decoded = JSON.parse(
      atob(token)
    )

    if (!decoded.expiresAt) return null

    if (Date.now() > decoded.expiresAt) return null

    return decoded

  } catch {

    return null

  }

}

export function encodeSession(session: Session): string {

  return btoa(JSON.stringify(session))

}
