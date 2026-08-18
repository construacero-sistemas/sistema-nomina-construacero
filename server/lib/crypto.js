// api/lib/crypto.js
// PBKDF2 helpers used only inside the Worker; PIN hashes never leave the server.

const PIN_ITERATIONS = 100_000
const PIN_HASH = 'SHA-256'

export async function hashPinPBKDF2(pin, salt) {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    throw new RangeError('PIN inválido')
  }
  if (typeof salt !== 'string' || salt.length < 16) {
    throw new RangeError('Salt inválido')
  }

  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: PIN_ITERATIONS, hash: PIN_HASH },
    keyMaterial,
    256,
  )
  return Array.from(new Uint8Array(bits))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyPinPBKDF2(pin, storedHash, storedSalt) {
  if (typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(storedHash)) return false
  try {
    const calculated = await hashPinPBKDF2(pin, storedSalt)
    return calculated.toLowerCase() === storedHash.toLowerCase()
  } catch {
    return false
  }
}

export function generateSalt() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export { PIN_ITERATIONS }
