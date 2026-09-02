// server/lib/cuentasCustodiaUtils.js
// Normalización y mapeo de las cuentas de custodia compartidas entre el backend
// (Supabase) y el frontend. Define los tipos/validación y el contrato de datos.

export const TIPOS_CUENTA_VALIDOS = ['banco_ves', 'efectivo_ves', 'efectivo_usd', 'zelle', 'cripto_usdt']

export const BANCOS_VENEZUELA = [
  'BNC (Banco Nacional de Crédito)',
  'Mercantil',
  'Banesco',
  'Banco de Venezuela',
  'BBVA Provincial',
  'Bancaribe',
  'Banco Exterior',
  'BFC (Banco Fondo Común)',
  'Banplus',
  'Otro Banco',
]

export const PLATAFORMAS_INTERNACIONALES = [
  'Binance Pay (USDT)',
  'Zelle',
  'Bank of America',
  'Wells Fargo',
  'Chase',
  'Banesco Panamá',
  'Zinli',
  'Wally Tech',
  'Paypal',
  'Otra Plataforma',
]

// Cuentas semilla por defecto. Cada fila incluye un `codigo` (slug estable) para
// identificar la semilla; el backend siembra estas cuentas en Supabase y el
// frontend las usa como fallback offline hasta que cargue del servidor.
export const CUENTAS_DEFAULT = [
  {
    id: 'banco-bnc-ves',
    codigo: 'banco-bnc-ves',
    nombre: 'Banco BNC (Principal)',
    tipo: 'banco_ves',
    cartera: 'VES',
    moneda: 'VES',
    banco: 'BNC (Banco Nacional de Crédito)',
    numeroCuenta: '0191-0001-23-4567890123',
    titular: 'Construacero C.A.',
    identificacion: 'J-12345678-9',
    subcuentaId: 'Banco en Bolívares',
    predeterminada: true,
    activo: true,
  },
  {
    id: 'banco-mercantil-ves',
    codigo: 'banco-mercantil-ves',
    nombre: 'Banco Mercantil',
    tipo: 'banco_ves',
    cartera: 'VES',
    moneda: 'VES',
    banco: 'Mercantil',
    numeroCuenta: '0105-0001-23-4567890123',
    titular: 'Construacero C.A.',
    identificacion: 'J-12345678-9',
    subcuentaId: 'Banco en Bolívares',
    predeterminada: true,
    activo: true,
  },
  {
    id: 'caja-efectivo-bs',
    codigo: 'caja-efectivo-bs',
    nombre: 'Caja Efectivo Bs',
    tipo: 'efectivo_ves',
    cartera: 'VES',
    moneda: 'VES',
    banco: 'Caja Física',
    titular: 'Construacero C.A.',
    subcuentaId: 'Efectivo Bs',
    predeterminada: true,
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
    titular: 'Construacero C.A.',
    subcuentaId: 'Efectivo $',
    predeterminada: true,
    activo: true,
  },
  {
    id: 'zelle-corp',
    codigo: 'zelle-corp',
    nombre: 'Zelle Corporativo',
    tipo: 'zelle',
    cartera: 'USD',
    moneda: 'USD',
    banco: 'Zelle',
    numeroCuenta: 'pagos@construacero.com',
    titular: 'Construacero C.A.',
    subcuentaId: 'Zelle',
    predeterminada: true,
    activo: true,
  },
  {
    id: 'binance-usdt',
    codigo: 'binance-usdt',
    nombre: 'Binance Pay (USDT)',
    tipo: 'cripto_usdt',
    cartera: 'USD',
    moneda: 'USDT',
    banco: 'Binance Pay (USDT)',
    numeroCuenta: 'Pay ID: 897654321',
    titular: 'Construacero C.A.',
    subcuentaId: 'USDT',
    predeterminada: true,
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

/**
 * Valida y normaliza el payload de una cuenta de custodia.
 * @param {object} input - Datos crudos del body
 * @returns {object} Cuenta normalizada lista para persistir
 * @throws {RangeError} Si algún campo validado no cumple las reglas
 */
export function normalizeCuentaCustodia(input = {}) {
  const tipo = String(input.tipo || '').trim()
  if (!TIPOS_CUENTA_VALIDOS.includes(tipo)) throw new RangeError('Tipo de cuenta inválido')

  const nombre = cleanString(input.nombre, NOMBRE_MAX)
  if (!nombre) throw new RangeError('El nombre o alias de la cuenta es obligatorio')

  // La cartera/moneda se derivan del tipo para no aceptar inconsistencias.
  const moneda = String(input.moneda || '').toUpperCase()
  const cartera = String(input.cartera || '').toUpperCase()
  if (!['VES', 'USD', 'USDT'].includes(moneda)) throw new RangeError('Moneda inválida')
  if (!['VES', 'USD'].includes(cartera)) throw new RangeError('Cartera inválida')

  const subcuentaId = cleanString(input.subcuentaId || input.subcuenta_id, 80)
  if (!subcuentaId) throw new RangeError('subcuentaId es obligatorio')

  const banco = cleanString(input.banco, 120)
  const numeroCuenta = cleanString(input.numeroCuenta || input.numero_cuenta, MAX_STR)
  const titular = cleanString(input.titular, 160)
  const identificacion = cleanString(input.identificacion, 60)
  const codigo = cleanString(input.codigo, 80)

  return {
    tipo,
    nombre,
    cartera,
    moneda,
    subcuentaId,
    banco: banco || nombre,
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
    activo: row.activo !== false,
    creadoEn: row.creado_en ?? null,
  }
}
