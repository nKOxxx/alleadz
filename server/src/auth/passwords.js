// server/src/auth/passwords.js
// scrypt (node:crypto, N=16384 r=8 p=1) — zero native deps, memory-hard.
// Format: scrypt$N$r$p$salt_b64$key_b64. Mirrors the Sovereign Grid pattern.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const N = 16384, R = 8, P = 1, KEYLEN = 32, SALT_LEN = 16
const PREFIX = 'scrypt'

export async function hashPassword(password) {
  const salt = randomBytes(SALT_LEN)
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P })
  return [PREFIX, N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const n = Number(nStr), r = Number(rStr), p = Number(pStr)
  if (![n, r, p].every(Number.isInteger) || n <= 0 || r <= 0 || p <= 0) return false
  const expected = Buffer.from(hashB64, 'base64')
  if (expected.length !== KEYLEN) return false
  try {
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), KEYLEN, { N: n, r, p })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export const PASSWORD_MIN_LENGTH = 8
