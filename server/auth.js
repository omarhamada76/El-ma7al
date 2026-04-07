/**
 * JWT signing and verification. Set JWT_SECRET in production.
 */
import jwt from 'jsonwebtoken'

export function getJwtSecret() {
  const s = process.env.JWT_SECRET
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production')
    }
    return 'dev-only-insecure-jwt-secret-change-me'
  }
  return s
}

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, getJwtSecret())
  } catch {
    return null
  }
}
