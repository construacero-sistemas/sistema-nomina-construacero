import { describe, expect, it } from 'vitest'
import { generateSalt, hashPinPBKDF2, verifyPinPBKDF2 } from '../crypto.js'

describe('credenciales de operador', () => {
  it('genera salts distintos y verifica el PIN correcto', async () => {
    const salt = generateSalt()
    const otroSalt = generateSalt()
    const hash = await hashPinPBKDF2('123456', salt)

    expect(salt).toHaveLength(32)
    expect(otroSalt).toHaveLength(32)
    expect(otroSalt).not.toBe(salt)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    await expect(verifyPinPBKDF2('123456', hash, salt)).resolves.toBe(true)
    await expect(verifyPinPBKDF2('000000', hash, salt)).resolves.toBe(false)
  })

  it('no acepta PINs fuera del contrato', async () => {
    await expect(hashPinPBKDF2('123', generateSalt())).rejects.toThrow(/PIN inválido/i)
    await expect(hashPinPBKDF2('abcdef', generateSalt())).rejects.toThrow(/PIN inválido/i)
    await expect(verifyPinPBKDF2('123456', 'hash-invalido', 'salt-invalido')).resolves.toBe(false)
  })
})
