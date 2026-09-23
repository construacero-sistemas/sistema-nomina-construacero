const GENERIC = new Set([
  'banco', 'bank', 'cuenta', 'cuentas', 'pago', 'pagos', 'transferencia', 'transferencias',
  'bolivares', 'bolivar', 'ves', 'usd', 'usdt', 'efectivo', 'caja', 'en', 'de', 'la', 'el',
])

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value) {
  return new Set(normalize(value).split(/\s+/).filter(token => token.length >= 4 && !GENERIC.has(token)))
}

function sourceText(movement) {
  return [movement.cuenta_origen, movement.metodo_pago, movement.referencia].filter(Boolean).join(' ')
}

function accountText(account) {
  return [account.nombre, account.banco, account.numero_cuenta, account.numeroCuenta, account.codigo].filter(Boolean).join(' ')
}

function activeAccounts(accounts) {
  return (Array.isArray(accounts) ? accounts : []).filter(account => account && account.activo !== false)
}

function accountCurrency(account) {
  return String(account.moneda || '').toUpperCase()
}

const CANONICAL_ACCOUNTS = Object.freeze({
  BANCO_VENEZUELA: 'Banco de Venezuela',
  BANCO_PROVINCIAL: 'Banco Provincial',
  USDT: 'USDT',
  EFECTIVO_USD: 'Efectivo USD',
  EFECTIVO_VES: 'Efectivo VES',
})

export function resolveCanonicalAccount(account = {}) {
  const text = normalize([account.nombre, account.banco, account.codigo].filter(Boolean).join(' '))
  const moneda = accountCurrency(account)
  if (/venezuela|bdv|banco de venezuela/.test(text)) return { key: 'BANCO_VENEZUELA', name: CANONICAL_ACCOUNTS.BANCO_VENEZUELA, status: 'confirmada' }
  if (/provincial|bbva/.test(text)) return { key: 'BANCO_PROVINCIAL', name: CANONICAL_ACCOUNTS.BANCO_PROVINCIAL, status: 'confirmada' }
  if (account.tipo === 'cripto_usdt' || moneda === 'USDT' || /usdt|binance|cripto/.test(text)) return { key: 'USDT', name: CANONICAL_ACCOUNTS.USDT, status: 'confirmada' }
  if (account.tipo === 'efectivo_usd' || (moneda === 'USD' && /efectivo|caja/.test(text))) return { key: 'EFECTIVO_USD', name: CANONICAL_ACCOUNTS.EFECTIVO_USD, status: 'confirmada' }
  if (account.tipo === 'efectivo_ves' || (moneda === 'VES' && /efectivo|caja/.test(text))) return { key: 'EFECTIVO_VES', name: CANONICAL_ACCOUNTS.EFECTIVO_VES, status: 'confirmada' }
  return { key: null, name: null, status: 'bloqueada', reason: 'La cuenta no tiene equivalencia canónica confirmada' }
}

function accountMapping(account) {
  const canonical = resolveCanonicalAccount(account)
  return { cuentaCustodiaId: account.id, cuentaActual: account.nombre, moneda: accountCurrency(account), ...canonical }
}

function isCash(account) {
  return account.tipo === 'efectivo_usd' || account.tipo === 'efectivo_ves' || /efectivo|caja/.test(normalize(account.nombre))
}

function isBank(account) {
  return account.tipo === 'banco_ves' || (!account.tipo && accountCurrency(account) === 'VES' && !isCash(account))
}

function matchingAccounts(movement, accounts) {
  const sourceTokens = tokens(sourceText(movement))
  if (!sourceTokens.size) return []
  return accounts.filter(account => {
    if (accountCurrency(account) !== String(movement.moneda || '').toUpperCase()) return false
    const accountTokens = tokens(accountText(account))
    return [...sourceTokens].some(token => accountTokens.has(token))
  })
}

function proposal(movement, account, reason, confidence = 'alta') {
  const canonical = resolveCanonicalAccount(account)
  if (canonical.status !== 'confirmada') {
    return { status: 'bloqueado', confidence: 'ninguna', cuentaCustodiaId: account.id, cuentaNombre: account.nombre, reason: canonical.reason, movementId: movement.id }
  }
  return {
    status: 'propuesta',
    confidence,
    safeToApply: true,
    cuentaCustodiaId: account.id,
    cuentaNombre: account.nombre,
    canonicalKey: canonical.key,
    canonicalName: canonical.name,
    reason,
    movementId: movement.id,
  }
}

// El sistema de Ventas POS no está en uso (decisión del jefe): sus filas no se
// asignan a cuentas, se excluyen y se proponen para anulación auditada.
function esVentaPos(movement) {
  if (String(movement.categoria || '').toLowerCase() !== 'ventas') return false
  const text = `${movement.concepto || ''} ${movement.referencia || ''}`
  return /ventas pos/i.test(text) || /\bpos-\d{4}-\d{2}-\d{2}/i.test(text)
}

function classifyMovement(movement, accounts) {
  if (movement.estado === 'anulado') return { status: 'omitido', reason: 'Movimiento anulado', movementId: movement.id }
  if (movement.cuenta_custodia_id) return { status: 'asignado', cuentaCustodiaId: movement.cuenta_custodia_id, movementId: movement.id, reason: 'Ya tiene cuenta de custodia' }
  if (esVentaPos(movement)) {
    return { status: 'excluir', movementId: movement.id, reason: 'Venta POS: sistema POS no listo, pendiente de anulación (decisión del jefe)' }
  }

  const active = activeAccounts(accounts)
  const currency = String(movement.moneda || '').toUpperCase()
  const candidates = active.filter(account => accountCurrency(account) === currency)
  if (!candidates.length) return { status: 'incompatible', movementId: movement.id, reason: `No existe una cuenta activa para ${currency}` }

  const explicitMatches = matchingAccounts(movement, candidates)
  if (explicitMatches.length === 1) {
    const account = explicitMatches[0]
    if (currency === 'VES' && !isBank(account) && !isCash(account)) {
      return { status: 'incompatible', movementId: movement.id, reason: 'La cuenta coincidente no es bancaria ni de efectivo VES' }
    }
    return proposal(movement, account, 'El origen coincide de forma inequívoca con el catálogo de cuentas')
  }
  if (explicitMatches.length > 1) {
    return { status: 'ambiguo', movementId: movement.id, reason: 'El texto coincide con más de una cuenta activa' }
  }

  if (currency === 'USDT') {
    const crypto = candidates.filter(account => account.tipo === 'cripto_usdt')
    if (crypto.length === 1) return proposal(movement, crypto[0], 'Es USDT y existe una única cuenta USDT activa')
    return { status: 'ambiguo', movementId: movement.id, reason: 'USDT sin una única cuenta cripto activa' }
  }

  if (currency === 'USD') {
    const cash = candidates.filter(isCash)
    if (cash.length === 1 && candidates.length === 1) {
      return proposal(movement, cash[0], 'Es USD y la única cuenta USD activa es efectivo')
    }
    if (cash.length === 1 && /efectivo|caja|\$|dolar|usd/.test(normalize(sourceText(movement)))) {
      return proposal(movement, cash[0], 'El origen indica efectivo en USD y coincide con la única caja USD')
    }
    return { status: 'ambiguo', movementId: movement.id, reason: 'USD sin origen inequívoco o con más de una cuenta USD' }
  }

  if (currency === 'VES') {
    const source = normalize(sourceText(movement))
    if (/efectivo|caja/.test(source)) {
      const cash = candidates.filter(isCash)
      if (cash.length === 1) return proposal(movement, cash[0], 'El origen indica efectivo VES y existe una única caja VES')
      return { status: 'ambiguo', movementId: movement.id, reason: 'Efectivo VES sin una única caja VES activa' }
    }
    const banks = candidates.filter(isBank)
    if (banks.length === 1 && !source) return proposal(movement, banks[0], 'Existe una única cuenta bancaria VES activa')
    return { status: 'ambiguo', movementId: movement.id, reason: banks.length > 1 ? 'VES con dos o más bancos y sin origen coincidente' : 'VES sin origen bancario inequívoco' }
  }

  return { status: 'ambiguo', movementId: movement.id, reason: 'No existe una regla segura para esta moneda' }
}

export function buildReconciliationPreview(movements, accounts) {
  const rows = (Array.isArray(movements) ? movements : []).map(movement => ({
    ...movement,
    propuesta: classifyMovement(movement, accounts),
  }))
  const counts = rows.reduce((result, row) => {
    result.total += 1
    result[row.propuesta.status] = (result[row.propuesta.status] || 0) + 1
    return result
  }, { total: 0, propuesta: 0, ambiguo: 0, incompatible: 0, asignado: 0, omitido: 0, excluir: 0 })
  const mappings = activeAccounts(accounts).map(accountMapping)
  return {
    counts,
    safeIds: rows.filter(row => row.propuesta.status === 'propuesta' && row.propuesta.safeToApply).map(row => row.id),
    blockedIds: rows.filter(row => row.propuesta.status === 'bloqueado').map(row => row.id),
    mappings,
    rows,
  }
}

export function accountReconciliationText(value) {
  return normalize(value)
}
