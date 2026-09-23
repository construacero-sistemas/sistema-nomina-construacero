const MANIFEST_HEADERS = [
  'snapshot_version',
  'total_servidor',
  'movimiento_id',
  'fecha',
  'creado_en',
  'tipo',
  'categoria',
  'concepto',
  'monto',
  'moneda',
  'metodo_pago',
  'cuenta_origen_actual',
  'cuenta_custodia_id_propuesta',
  'cuenta_actual_propuesta',
  'cuenta_canonica_propuesta',
  'estado_propuesta',
  'seguro_para_aplicar',
  'confianza',
  'regla',
  'tasa_sellada',
  'nota_sustitucion',
  'creado_por',
  'nota_autoria',
]

function toText(input) {
  return input == null ? '' : String(input)
}

function csvCell(input) {
  return `"${toText(input).replaceAll('"', '""')}"`
}

export function buildReconciliationManifest(preview, generatedAt = new Date().toISOString()) {
  const snapshotVersion = toText(preview?.versionLibro || 'no-informada')
  const totalServidor = preview?.totalServidor ?? preview?.counts?.total ?? 0
  const rows = (preview?.rows || []).map(row => {
    const proposal = row.propuesta || {}
    const safe = proposal.status === 'propuesta' && proposal.safeToApply === true
    return {
      snapshot_version: snapshotVersion,
      total_servidor: totalServidor,
      movimiento_id: row.id,
      fecha: row.fecha,
      creado_en: row.creado_en,
      tipo: row.tipo,
      categoria: row.categoria,
      concepto: row.concepto,
      monto: row.monto,
      moneda: row.moneda,
      metodo_pago: row.metodo_pago,
      cuenta_origen_actual: row.cuenta_origen,
      cuenta_custodia_id_propuesta: proposal.cuentaCustodiaId,
      cuenta_actual_propuesta: proposal.cuentaNombre,
      cuenta_canonica_propuesta: proposal.canonicalName,
      estado_propuesta: proposal.status,
      seguro_para_aplicar: safe ? 'si' : 'no',
      confianza: proposal.confidence,
      regla: proposal.reason,
      tasa_sellada: row.tasa_registrada_en ? 'si' : 'no',
      nota_sustitucion: row.tasa_registrada_en ? '' : 'Requiere sustitución sellada (gemela con sello + anulación de la original) para valorar USD',
      creado_por: '',
      nota_autoria: 'No modificar creado_por; registrar conciliado_por por separado',
    }
  })
  return {
    formato: 'manifiesto-conciliacion-v1',
    generado_en: generatedAt,
    snapshot_version: snapshotVersion,
    total_servidor: totalServidor,
    total_filas: rows.length,
    ids_seguros: rows.filter(row => row.seguro_para_aplicar === 'si').map(row => row.movimiento_id),
    ids_bloqueados: rows.filter(row => row.seguro_para_aplicar !== 'si').map(row => row.movimiento_id),
    filas: rows,
  }
}

export function manifestToCsv(manifest) {
  const rows = manifest?.filas || []
  return [MANIFEST_HEADERS, ...rows.map(row => MANIFEST_HEADERS.map(header => csvCell(row[header])))]
    .map(row => row.join(';'))
    .join('\n')
}

export function downloadReconciliationManifest(preview, format = 'csv', now = new Date()) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const manifest = buildReconciliationManifest(preview, now.toISOString())
  const date = now.toISOString().slice(0, 10)
  const isJson = format === 'json'
  const body = isJson
    ? JSON.stringify(manifest, null, 2)
    : `\ufeff${manifestToCsv(manifest)}`
  const blob = new Blob([body], { type: isJson ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `manifiesto-conciliacion-${date}.${isJson ? 'json' : 'csv'}`
  link.click()
  URL.revokeObjectURL(url)
  return true
}
