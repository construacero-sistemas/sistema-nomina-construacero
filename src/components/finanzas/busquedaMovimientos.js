// Buscador inteligente de movimientos. Entiende, en una sola caja de texto:
//   - palabras: concepto, categoría, referencia, observaciones y método (sin tildes ni mayúsculas)
//   - "frase exacta" entre comillas
//   - #123            → número de registro
//   - 1500000 / 1.500.000,50 → monto exacto (o el número dentro del concepto/referencia)
//   - >50000  <=1000  100..500 → rangos de monto
//   - ingreso(s) / egreso(s) / entrada(s) / salida(s) → tipo
//   - 28 oct · 28/10 · 2026-10-28 · octubre → fecha
//   - anulado(s) → solo anulados
//   - repetido(s) / duplicado(s) → misma fecha, tipo, monto y concepto que otro movimiento
// Todos los criterios se combinan con "y".

const MESES = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, set: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
}
const NOMBRE_MES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const TIPOS = { ingreso: 'ingreso', ingresos: 'ingreso', entrada: 'ingreso', entradas: 'ingreso', egreso: 'egreso', egresos: 'egreso', salida: 'egreso', salidas: 'egreso' }

export function normalizarTexto(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// "1.500.000,50" (es) · "1,500,000.50" (en) · "1500000.5" → número; null si no es un monto.
export function parsearMonto(texto) {
  const t = String(texto).trim()
  if (!/^\d[\d.,]*$/.test(t)) return null
  let limpio
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) limpio = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) limpio = t.replace(/,/g, '')
  else limpio = t.replace(',', '.')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

const formatoMonto = n => Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })
const dos = n => String(n).padStart(2, '0')

// Convierte el texto en criterios. `etiquetas` es lo que se le muestra al usuario ("Entendí: …").
export function interpretarBusqueda(texto) {
  const criterios = []
  const etiquetas = []
  let resto = normalizarTexto(texto).replace(/([<>]=?)\s+(\d)/g, '$1$2')
  if (!resto) return { criterios, etiquetas, vacia: true }

  // Frases entre comillas
  resto = resto.replace(/"([^"]+)"|«([^»]+)»/g, (_m, a, b) => {
    const frase = (a || b || '').trim()
    if (frase) { criterios.push({ tipo: 'texto', valor: frase }); etiquetas.push(`Contiene «${frase}»`) }
    return ' '
  })
  // "28 oct", "28 de octubre"
  const alt = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|')
  resto = resto.replace(new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${alt})\\b`, 'g'), (_m, d, mes) => {
    criterios.push({ tipo: 'fecha', mes: MESES[mes], dia: Number(d) })
    etiquetas.push(`Fecha ${Number(d)} ${NOMBRE_MES[MESES[mes]]}`)
    return ' '
  })

  for (const token of resto.split(' ').filter(Boolean)) {
    let m
    if ((m = token.match(/^#(\d+)$/))) {
      criterios.push({ tipo: 'numero', valor: Number(m[1]) }); etiquetas.push(`Registro n.º ${Number(m[1])}`)
    } else if ((m = token.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      criterios.push({ tipo: 'fecha', anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) }); etiquetas.push(`Fecha ${m[3]}/${m[2]}/${m[1]}`)
    } else if ((m = token.match(/^(\d{1,2})[/-](\d{1,2})$/)) && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
      criterios.push({ tipo: 'fecha', mes: Number(m[2]), dia: Number(m[1]) }); etiquetas.push(`Fecha ${dos(m[1])}/${dos(m[2])}`)
    } else if ((m = token.match(/^(>=|<=|>|<)\s*(.+)$/)) && parsearMonto(m[2]) != null) {
      const valor = parsearMonto(m[2])
      criterios.push({ tipo: 'comparar', op: m[1], valor }); etiquetas.push(`Monto ${m[1]} ${formatoMonto(valor)}`)
    } else if ((m = token.match(/^([\d.,]+)\.\.([\d.,]+)$/)) && parsearMonto(m[1]) != null && parsearMonto(m[2]) != null) {
      const a = parsearMonto(m[1]), b = parsearMonto(m[2])
      criterios.push({ tipo: 'rango', min: Math.min(a, b), max: Math.max(a, b) }); etiquetas.push(`Monto entre ${formatoMonto(Math.min(a, b))} y ${formatoMonto(Math.max(a, b))}`)
    } else if (TIPOS[token]) {
      criterios.push({ tipo: 'tipoMov', valor: TIPOS[token] }); etiquetas.push(TIPOS[token] === 'ingreso' ? 'Solo ingresos' : 'Solo egresos')
    } else if (token === 'anulado' || token === 'anulados') {
      criterios.push({ tipo: 'anulado' }); etiquetas.push('Solo anulados')
    } else if (token === 'repetido' || token === 'repetidos' || token === 'duplicado' || token === 'duplicados') {
      criterios.push({ tipo: 'repetido' }); etiquetas.push('Posibles repetidos')
    } else if (MESES[token] && token.length >= 3) {
      criterios.push({ tipo: 'fecha', mes: MESES[token] }); etiquetas.push(`Mes de ${token}`)
    } else if (parsearMonto(token) != null) {
      criterios.push({ tipo: 'numeroOMonto', valor: parsearMonto(token), crudo: token }); etiquetas.push(`Número o monto ${token}`)
    } else {
      criterios.push({ tipo: 'texto', valor: token }); etiquetas.push(`Contiene «${token}»`)
    }
  }
  return { criterios, etiquetas, vacia: criterios.length === 0 }
}

function pajar(m) {
  return normalizarTexto([m.concepto, m.categoria, m.referencia, m.observaciones, m.metodo_pago, m.metodoPago, m.cuenta_origen].filter(Boolean).join(' | '))
}

export function clavesRepetidas(rows) {
  const grupos = new Map()
  for (const m of rows) {
    if (m.estado === 'anulado') continue
    const clave = `${m.fecha}|${m.tipo}|${Number(m.monto)}|${normalizarTexto(m.concepto)}`
    grupos.set(clave, (grupos.get(clave) || 0) + 1)
  }
  return new Set([...grupos].filter(([, n]) => n > 1).map(([k]) => k))
}

export function filtrarMovimientos(rows, texto) {
  const { criterios, vacia } = interpretarBusqueda(texto)
  if (vacia) return rows
  const repetidas = criterios.some(c => c.tipo === 'repetido') ? clavesRepetidas(rows) : null
  return rows.filter(m => {
    const monto = Number(m.monto)
    const fecha = String(m.fecha || '').slice(0, 10)
    const [anio, mes, dia] = fecha.split('-').map(Number)
    let texto_ = null
    return criterios.every(c => {
      switch (c.tipo) {
        case 'texto': texto_ ??= pajar(m); return texto_.includes(c.valor)
        case 'numero': return Number(m.numero) === c.valor
        case 'numeroOMonto':
          texto_ ??= pajar(m)
          return Number(m.numero) === c.valor || Math.abs(monto - c.valor) < 0.005 || texto_.includes(normalizarTexto(c.crudo))
        case 'comparar':
          return c.op === '>' ? monto > c.valor : c.op === '>=' ? monto >= c.valor : c.op === '<' ? monto < c.valor : monto <= c.valor
        case 'rango': return monto >= c.min && monto <= c.max
        case 'tipoMov': return m.tipo === c.valor
        case 'anulado': return m.estado === 'anulado'
        case 'fecha': return (c.anio == null || c.anio === anio) && (c.mes == null || c.mes === mes) && (c.dia == null || c.dia === dia)
        case 'repetido': return m.estado !== 'anulado' && repetidas.has(`${m.fecha}|${m.tipo}|${Number(m.monto)}|${normalizarTexto(m.concepto)}`)
        default: return true
      }
    })
  })
}
