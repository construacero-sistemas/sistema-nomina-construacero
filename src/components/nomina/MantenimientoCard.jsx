// src/components/nomina/MantenimientoCard.jsx
// Zona de mantenimiento: purga de REGISTROS operativos (Nómina + Finanzas) con
// respaldo obligatorio previo. NUNCA borra cuentas (usuarios) ni empleados
// (clientes): solo el histórico de tablas operativas, siempre por cuenta.
//
// Candados: EXCLUSIVA del rol jefe (capacidad `purgarRegistros` de la matriz
// única; el servidor la exige y la interfaz no la ofrece a otros roles), frase
// de confirmación «ELIMINAR», alcance total o por rango de fechas, previo de
// conteos y respaldo descargable antes/después de ejecutar.
import { useState } from 'react'
import { AlertTriangle, CalendarRange, Database, Download, Loader2, ShieldAlert, Trash2 } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { showToast } from '../../../compat/components/ui/toastBus.js'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../../config/accesoModulos.js'
import { Card, CardTitle, CardDescription, Button } from '../ui/index.js'
import { apiGet, apiPost } from '../../hooks/nominaApi.js'

const ETIQUETAS_TABLA = {
  registro_asistencia: 'Asistencia (marcajes, horas y ausencias)',
  nomina_periodos: 'Períodos de nómina',
  nomina_lineas: 'Líneas de nómina',
  nomina_linea_conceptos: 'Conceptos de las líneas',
  nomina_tasas_snapshot: 'Tasas congeladas de los períodos',
  finanzas_movimientos: 'Movimientos de Finanzas',
  finanzas_operaciones: 'Operaciones (pagos y transferencias)',
  finanzas_nomina_asignaciones: 'Pagos de nómina vinculados',
  finanzas_operacion_contexto: 'Contexto de operaciones',
  finanzas_libro_version: 'Versión del libro contable',
}

const FRASE = 'ELIMINAR'

// Módulos purgables (dominio, no roles): en objeto y no en lista para no
// confundir al guardrail de roles literales de check-project.
const MODULOS_UI = {
  nomina: 'Nómina (asistencia, períodos, líneas)',
  finanzas: 'Finanzas (movimientos, operaciones, pagos)',
}

const inputFecha = 'mt-2 w-full h-11 rounded-xl border border-border-subtle bg-slate-50 px-3 text-sm text-content-main focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

export default function MantenimientoCard() {
  const perfil = useAuthStore(state => state.perfil)
  const [conteos, setConteos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [modulos, setModulos] = useState({ nomina: true, finanzas: true })
  const [alcance, setAlcance] = useState('todo')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [frase, setFrase] = useState('')
  const [ejecutando, setEjecutando] = useState(false)
  const [resultado, setResultado] = useState(null)

  // La purga es exclusiva del rol jefe (matriz única); los demás roles jamás
  // ven esta tarjeta aunque conozcan la ruta.
  if (!tieneCapacidad(perfil, 'purgarRegistros')) return null

  const seleccion = Object.keys(modulos).filter(m => modulos[m])
  const rangoActivo = alcance === 'rango'
  const rangoValido = !rangoActivo || Boolean(desde || hasta) && !(desde && hasta && desde > hasta)
  const rango = rangoActivo ? { desde: desde || null, hasta: hasta || null } : { desde: null, hasta: null }
  const listo = frase.trim().toUpperCase() === FRASE && seleccion.length > 0 && rangoValido && !ejecutando

  const consulta = () => `/api/mantenimiento/purga-preview?modulos=${seleccion.join(',')}` +
    (rangoActivo ? `&desde=${desde || ''}&hasta=${hasta || ''}` : '')

  async function verPrevio() {
    setCargando(true)
    try {
      const data = await apiGet(consulta())
      setConteos(data.conteos || {})
    } catch (err) {
      showToast(err.message || 'No se pudo calcular el previo', 'error')
    } finally {
      setCargando(false)
    }
  }

  async function ejecutarPurga() {
    if (!listo) return
    setEjecutando(true)
    try {
      const data = await apiPost('/api/mantenimiento/purgar', {
        modulos: seleccion,
        confirmacion: FRASE,
        ...(rangoActivo ? { desde: rango.desde, hasta: rango.hasta } : {}),
      })
      setResultado(data)
      setModalAbierto(false)
      setFrase('')
      setConteos(null)
      showToast(`Purga completa: ${data.total_eliminadas} registros eliminados con respaldo`, 'success')
    } catch (err) {
      showToast(err.message || 'No se pudo completar la purga', 'error')
    } finally {
      setEjecutando(false)
    }
  }

  async function descargarRespaldo() {
    if (!resultado?.backup_id) return
    try {
      const data = await apiGet(`/api/mantenimiento/purga-backup?id=${resultado.backup_id}`)
      const blob = new Blob([JSON.stringify(data.respaldo, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = `respaldo-purga-${String(resultado.backup_id).slice(0, 8)}.json`
      enlace.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast(err.message || 'No se pudo descargar el respaldo', 'error')
    }
  }

  return (
    <Card>
      <div>
        <CardTitle>Zona de mantenimiento — purga de registros</CardTitle>
        <CardDescription>
          Borra el histórico de <strong>Nómina</strong> (asistencia, períodos, líneas y tasas congeladas) y de{' '}
          <strong>Finanzas</strong> (movimientos, operaciones y pagos vinculados). <strong>No borra cuentas ni
          empleados</strong> ni configuraciones. Puedes purgar todo el histórico o acotarlo a un rango de
          fechas. Cada purga guarda un respaldo completo descargable y queda registrada en auditoría.
        </CardDescription>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <p>
          Acción irreversible en el sistema (el respaldo permite restaurar los datos manualmente si hiciera falta).
          Úsala solo para arrancar en limpio o retirar datos de prueba. <strong>Exclusiva del rol Jefe.</strong>
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-black text-content-main uppercase tracking-wide">Alcance de la purga</legend>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-border-subtle p-3 min-h-11">
            <input
              type="radio"
              name="alcance-purga"
              checked={!rangoActivo}
              onChange={() => setAlcance('todo')}
              className="h-5 w-5 border-slate-300"
            />
            <span className="text-sm font-semibold text-content-main">Todo el histórico</span>
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-border-subtle p-3 min-h-11">
            <input
              type="radio"
              name="alcance-purga"
              checked={rangoActivo}
              onChange={() => setAlcance('rango')}
              className="h-5 w-5 border-slate-300"
            />
            <span className="text-sm font-semibold text-content-main">Rango de fechas</span>
          </label>
        </div>
        {rangoActivo && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-black text-content-main uppercase tracking-wide">Desde (opcional)</span>
              <input type="date" value={desde} onChange={event => setDesde(event.target.value)} className={inputFecha} />
            </label>
            <label className="block">
              <span className="text-xs font-black text-content-main uppercase tracking-wide">Hasta (opcional)</span>
              <input type="date" value={hasta} onChange={event => setHasta(event.target.value)} className={inputFecha} />
            </label>
            <p className="text-[11px] text-slate-400 sm:col-span-2">
              Se borra lo que cae en el rango y todo lo que depende de ello (las líneas de un período, los
              movimientos y pagos de una operación). Deja un lado vacío para dejarlo abierto.
            </p>
            {!rangoValido && (
              <p className="text-xs text-red-600 font-semibold sm:col-span-2" role="alert">
                Indica al menos una fecha, y que «desde» no sea posterior a «hasta».
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={verPrevio} disabled={cargando || seleccion.length === 0 || !rangoValido}>
          {cargando ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
          Ver qué se borraría
        </Button>
        <Button variant="danger" onClick={() => setModalAbierto(true)} disabled={seleccion.length === 0 || !rangoValido}>
          <Trash2 size={16} />
          Purgar registros…
        </Button>
        {resultado?.backup_id && (
          <Button variant="ghost" onClick={descargarRespaldo}>
            <Download size={16} />
            Descargar respaldo
          </Button>
        )}
      </div>

      {conteos && (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table>
            <thead>
              <tr><th>Tabla</th><th className="num">Filas</th></tr>
            </thead>
            <tbody>
              {Object.entries(conteos).map(([tabla, filas]) => (
                <tr key={tabla}>
                  <td>{ETIQUETAS_TABLA[tabla] || tabla}</td>
                  <td className="num">{filas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resultado && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          Purga ejecutada: <strong>{resultado.total_eliminadas}</strong> registros eliminados
          {resultado.rango?.desde || resultado.rango?.hasta
            ? <> en el rango <strong>{resultado.rango?.desde || '…'} → {resultado.rango?.hasta || '…'}</strong></>
            : null}.
          Respaldo <code>{String(resultado.backup_id).slice(0, 8)}</code> guardado — puedes descargarlo con el botón de arriba.
        </div>
      )}

      <Modal isOpen={modalAbierto} onClose={() => !ejecutando && setModalAbierto(false)} title="Purgar registros de Nómina y Finanzas">
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>
              Se borrará el histórico seleccionado ({rangoActivo
                ? <>del rango <strong>{desde || '…'} → {hasta || '…'}</strong> y lo que dependa de él</>
                : <strong>completo</strong>}) y se guardará un respaldo previo. <strong>No se borran
              cuentas, empleados, configuraciones ni catálogos.</strong>
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-black text-content-main uppercase tracking-wide">Módulos a purgar</legend>
            {Object.entries(MODULOS_UI).map(([modulo, etiqueta]) => (
              <label key={modulo} className="flex items-center gap-3 rounded-xl border border-border-subtle p-3 min-h-11">
                <input
                  type="checkbox"
                  checked={modulos[modulo]}
                  onChange={() => setModulos(prev => ({ ...prev, [modulo]: !prev[modulo] }))}
                  className="h-5 w-5 rounded border-slate-300"
                />
                <span className="text-sm font-semibold text-content-main">{etiqueta}</span>
              </label>
            ))}
          </fieldset>

          {rangoActivo && (
            <div className="flex items-start gap-2 rounded-xl border border-border-subtle bg-slate-50 p-3 text-xs text-content-main">
              <CalendarRange size={16} className="mt-0.5 shrink-0" />
              <p>Rango de fechas: <strong>{desde || '…'} → {hasta || '…'}</strong></p>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-black text-content-main uppercase tracking-wide">
              Escribe {FRASE} para confirmar
            </span>
            <input
              type="text"
              value={frase}
              onChange={event => setFrase(event.target.value)}
              placeholder={FRASE}
              autoComplete="off"
              className="mt-2 w-full h-11 rounded-xl border border-border-subtle bg-slate-50 px-3 text-sm text-content-main focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </label>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="ghost" onClick={() => setModalAbierto(false)} disabled={ejecutando}>Cancelar</Button>
            <Button variant="danger" onClick={ejecutarPurga} disabled={!listo}>
              {ejecutando ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Purgar definitivamente
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
