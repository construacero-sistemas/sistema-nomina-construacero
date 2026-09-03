// server/lib/cuentasCustodiaUtils.js
// Normalización y mapeo de las cuentas de custodia compartidas entre el backend
// (Supabase) y el frontend. Define los tipos/validación y el contrato de datos.

export const TIPOS_CUENTA_VALIDOS = ['banco_ves', 'efectivo_ves', 'efectivo_usd', 'zelle', 'cripto_usdt']

// Cajas físicas PERMANENTES: el dinero que no está en un banco está en la caja,
// así que estas dos cuentas siempre deben existir (migración 230 las protege en
// la BD: no se pueden desactivar ni borrar). Se identifican por su `codigo`
// semilla, que sobrevive renombres y ediciones cosméticas.
export const CAJAS_PERMANENTES = ['caja-efectivo-bs', 'caja-efectivo-usd']

export function esCajaPermanente(cuenta) {
  const codigo = typeof cuenta === 'string' ? cuenta : cuenta?.codigo
  return Boolean(codigo && CAJAS_PERMANENTES.includes(codigo))
}

export const BANCOS_VENEZUELA = [
  'BNC (Banco Nacional de Crédito)',
  'Banesco',
  'Mercantil',
  'Banco de Venezuela',
  'BBVA Provincial',
  'Bancamiga',
  'Bancaribe',
  'Banco Bicentenario',
  'Banco del Tesoro',
  'Banplus',
  'BFC (Banco Fondo Común)',
  'Banco Exterior',
  '100% Banco',
  'Banco Plaza',
  'Venezolano de Crédito',
  'BANFANB',
  'Banco Activo',
  'DelSur Banco Universal',
  'Banco Caroní',
  'Banco Sofitasa',
  'Bancrecer',
  'Mi Banco',
  'Banco Agrícola de Venezuela',
  'Bangente',
  'Banco Internacional de Desarrollo',
  'Otro Banco',
]

export const PLATAFORMAS_CRIPTO = [
  'Binance Pay (USDT)',
  'Binance P2P (USDT)',
  'Bybit (USDT)',
  'OKX (USDT)',
  'Billetera Cripto (USDT)',
  'Otra Billetera Cripto',
]

export const PLATAFORMAS_ZELLE_USD = [
  'Zelle',
  'Bank of America (USD)',
  'Wells Fargo (USD)',
  'Chase (USD)',
  'Banesco Panamá (USD)',
  'Zinli (USD)',
  'Wally Tech (USD)',
  'Paypal (USD)',
  'Otro Banco Internacional',
]

export const PLATAFORMAS_INTERNACIONALES = [
  ...PLATAFORMAS_CRIPTO,
  ...PLATAFORMAS_ZELLE_USD,
]

// Cuentas semilla. Un negocio nuevo arranca SOLO con las dos cajas físicas
// (universales y permanentes): bancos, Zelle, billeteras los crea el usuario
// real con sus datos. Nada de datos de ejemplo falsos (números de cuenta, RIF).
// El frontend usa esta lista como fallback offline hasta que cargue el servidor.
export const CUENTAS_DEFAULT = [
  {
    id: 'caja-efectivo-bs',
    codigo: 'caja-efectivo-bs',
    nombre: 'Caja Efectivo Bs',
    tipo: 'efectivo_ves',
    cartera: 'VES',
    moneda: 'VES',
    banco: 'Caja Física',
    subcuentaId: 'Efectivo Bs',
    predeterminada: true,
    permanente: true,
    activo: true,
  },
  {
    id: 'caja-efectivo-usd',
    codigo: 'caja-efectivo-usd',
    nombre: 'Caja Efectivo $',
    tipo: 'efectivo_usd',
    cartera: 'USD',
    moneda: 'USD',
    banco: 'Caja Fuerte',
    subcuentaId: 'Efectivo $',
    predeterminada: true,
    permanente: true,
    activo: true,
  },
]

export const TIPOS_CUENTA = [
  { value: 'banco_ves',    label: 'Banco Nacional (Bolívares Bs)',      moneda: 'VES', cartera: 'VES', subcuentaId: 'Banco en Bolívares' },
  { value: 'efectivo_ves', label: 'Caja Física (Efectivo Bs)',          moneda: 'VES', cartera: 'VES', subcuentaId: 'Efectivo Bs' },
  { value: 'efectivo_usd', label: 'Caja Física (Efectivo Dólares $)',    moneda: 'USD', cartera: 'USD', subcuentaId: 'Efectivo $' },
  { value: 'zelle',        label: 'Zelle / Banco Internacional (USD)',  moneda: 'USD', cartera: 'USD', subcuentaId: 'Zelle' },
  { value: 'cripto_usdt',  label: 'Billetera Cripto / Binance (USDT)',   moneda: 'USDT', cartera: 'USD', subcuentaId: 'USDT' },
]

const MAX_STR = 200
const NOMBRE_MAX = 80

function cleanString(value, max = MAX_STR) {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s.slice(0, max) : null
}

export function capitalizarTexto(str) {
  if (!str || typeof str !== 'string') return ''
  const trimmed = String(str).trim()
  if (!trimmed) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export function capitalizarPalabras(str) {
  if (!str || typeof str !== 'string') return ''
  const EXCEPCIONES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'a', 'por', 'con'])
  return String(str)
    .trim()
    .split(/\s+/)
    .map((word, idx) => {
      if (!word) return ''
      if (word.length > 1 && word === word.toUpperCase()) return word
      const cleanWord = word.replace(/^[^\w]+|[^\w]+$/g, '')
      if (cleanWord.length > 1 && cleanWord === cleanWord.toUpperCase() && !/^\d+$/.test(cleanWord)) {
        return word
      }
      const lower = word.toLowerCase()
      if (idx > 0 && EXCEPCIONES.has(lower)) return lower
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * Valida y normaliza el payload de una cuenta de custodia.
 * @param {object} input - Datos crudos del body
 * @returns {object} Cuenta normalizada lista para persistir
 * @throws {RangeError} Si algún campo validado no cumple las reglas
 */
export function normalizeCuentaCustodia(input = {}) {
  const tipo = String(input.tipo || '').trim()
  if (!TIPOS_CUENTA_VALIDOS.includes(tipo)) throw new RangeError('Tipo de cuenta inválido')

  const nombreLimpio = cleanString(input.nombre, NOMBRE_MAX)
  if (!nombreLimpio) throw new RangeError('El nombre o alias de la cuenta es obligatorio')
  const nombre = capitalizarPalabras(nombreLimpio)

  // La cartera/moneda se derivan del tipo para no aceptar inconsistencias.
  const moneda = String(input.moneda || '').toUpperCase()
  const cartera = String(input.cartera || '').toUpperCase()
  if (!['VES', 'USD', 'USDT'].includes(moneda)) throw new RangeError('Moneda inválida')
  if (!['VES', 'USD'].includes(cartera)) throw new RangeError('Cartera inválida')

  const subcuentaId = cleanString(input.subcuentaId || input.subcuenta_id, 80)
  if (!subcuentaId) throw new RangeError('subcuentaId es obligatorio')

  const bancoLimpio = cleanString(input.banco, 120)
  const banco = bancoLimpio ? capitalizarPalabras(bancoLimpio) : nombre
  const numeroCuenta = cleanString(input.numeroCuenta || input.numero_cuenta, MAX_STR)
  const titularLimpio = cleanString(input.titular, 160)
  const titular = titularLimpio ? capitalizarPalabras(titularLimpio) : null
  const identificacion = cleanString(input.identificacion, 60)
  const codigo = cleanString(input.codigo, 80)

  return {
    tipo,
    nombre,
    cartera,
    moneda,
    subcuentaId,
    banco,
    numeroCuenta,
    titular,
    identificacion,
    codigo,
  }
}

/**
 * Mapea una fila de la tabla `cuentas_custodia` (snake_case) al contrato del frontend.
 * @param {object} row - Fila de Supabase
 * @returns {object} Objeto de cuenta listo para la UI
 */
export function cuentaCustodiaResponse(row) {
  if (!row) return null
  return {
    id: row.id,
    codigo: row.codigo ?? null,
    nombre: row.nombre,
    tipo: row.tipo,
    cartera: row.cartera,
    moneda: row.moneda,
    banco: row.banco ?? null,
    numeroCuenta: row.numero_cuenta ?? null,
    titular: row.titular ?? null,
    identificacion: row.identificacion ?? null,
    subcuentaId: row.subcuenta_id,
    predeterminada: Boolean(row.predeterminada),
    // La permanencia se deriva del codigo semilla (sin columna en la BD): las
    // cajas físicas viajan con permanente=true para que la UI oculte el borrado.
    permanente: esCajaPermanente(row),
    activo: row.activo !== false,
    creadoEn: row.creado_en ?? null,
  }
}
