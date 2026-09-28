// src/components/sistema/UsuariosPanel.jsx
// Panel de gestión de usuarios operativos (jefe / finanzas / nomina).
// Reglas visibles al usuario: máximo por rol, PIN por rol (finanzas/nomina: 4
// dígitos; el resto: 6 — derivado de la matriz única), todo reversible
// (desactivar nunca borra; se puede reactivar desde la misma lista).
// El rol `administracion` fue convergido a `jefe`; la UI solo ofrece roles vigentes.
import { useState } from 'react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import PinInput from '../../../compat/components/auth/PinInput.jsx'
import { showToast } from '../../../compat/components/ui/toastBus.js'
import {
  Users, Plus, Loader2, KeyRound, Pencil, ShieldCheck, ShieldOff, UserCog,
} from 'lucide-react'
import {
  useOperadores, useCrearOperador, useCambiarEstadoOperador,
  useCambiarPinOperador, useCambiarRolOperador, useCambiarNombreOperador,
} from '../../hooks/useGestionOperadores.js'
import { etiquetaRol, ROLES_CREABLES, longitudPin } from '../../config/accesoModulos.js'
import useAuthStore from '../../../compat/store/useAuthStore'

// Los roles ofrecibles y sus etiquetas derivan de la matriz única
// (config/accesoModulos reexporta server/lib/permissions.js).
const DESCRIPCION_ROL = {
  jefe: 'acceso total (ambos módulos + usuarios)',
  desarrollador: 'soporte técnico, acceso total',
  finanzas: 'registra ingresos/egresos, no ve saldos',
  nomina: 'lleva asistencia y pagos, no ve finanzas',
}

// Etiqueta corta en el disparador; la descripción vive en `sub` y solo se ve en
// el desplegable (así el texto largo nunca parte palabras dentro del select).
const ROLES = ROLES_CREABLES.map(value => ({
  value,
  label: etiquetaRol(value),
  selectedLabel: etiquetaRol(value),
  sub: DESCRIPCION_ROL[value],
}))

function opcionesConActual(actual) {
  return ROLES.some(rol => rol.value === actual)
    ? ROLES
    : [...ROLES, { value: actual, label: etiquetaRol(actual), selectedLabel: etiquetaRol(actual), sub: DESCRIPCION_ROL[actual] }]
}

function CrearUsuarioForm({ onCrear, pending }) {
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState('finanzas')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const largoPin = longitudPin(rol)

  async function submit(e) {
    e.preventDefault()
    if (nombre.trim().length < 3) return setError('El nombre debe tener al menos 3 caracteres.')
    if (pin.length !== largoPin) return setError(`El PIN debe ser de ${largoPin} dígitos.`)
    setError('')
    try {
      await onCrear({ nombre: nombre.trim(), rol, pin })
      setNombre(''); setPin(''); setRol('finanzas')
    } catch (err) {
      setError(err.message || 'No se pudo crear el usuario.')
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nombre *</span>
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: María Pérez"
            maxLength={60}
            disabled={pending}
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-800"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Rol *</span>
          <CustomSelect
            options={ROLES}
            value={rol}
            onChange={v => setRol(v)}
            placeholder="Selecciona el rol"
            showSubInTrigger={false}
            disabled={pending}
          />
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <label className="block">
          <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">PIN de acceso ({largoPin} dígitos) *</span>
          <PinInput value={pin} onChange={setPin} disabled={pending} length={largoPin} />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Crear usuario
        </button>
      </div>
      <p className="text-[11px] text-slate-400">El PIN se cifra antes de guardarlo y el usuario lo escribirá cada vez que entre. {etiquetaRol(rol)} usa {largoPin} dígitos.</p>
      {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}
    </form>
  )
}

export default function UsuariosPanel({ open, onClose }) {
  const { data, isLoading, error } = useOperadores({ enabled: open })
  const crear = useCrearOperador()
  const cambiarEstado = useCambiarEstadoOperador()
  const cambiarPin = useCambiarPinOperador()
  const cambiarRol = useCambiarRolOperador()
  const cambiarNombre = useCambiarNombreOperador()

  const [pinPara, setPinPara] = useState(null) // usuario en edición de PIN
  const [nuevoPin, setNuevoPin] = useState('')
  const [confirmarPin, setConfirmarPin] = useState('')
  const [rolPara, setRolPara] = useState(null)
  const [rolNuevo, setRolNuevo] = useState('')
  const [nombrePara, setNombrePara] = useState(null) // usuario en edición de nombre
  const [nombreNuevo, setNombreNuevo] = useState('')

  const usuarios = data?.usuarios || []

  // Nadie puede desactivarse a sí mismo desde la pantalla: se quedaría sin
  // operador activo y cada pantalla respondería «sin autorización» (el 403 de
  // operador inválido cierra la sesión) hasta que otro jefe lo reactive.
  const perfil = useAuthStore(s => s.perfil)
  const propioId = perfil?.operador_id || perfil?.id || null
  const esPropio = (u) => Boolean(propioId) && u.id === propioId

  async function toggleEstado(u) {
    if (esPropio(u)) return
    try {
      await cambiarEstado.mutateAsync({ id: u.id, activo: !u.activo })
      showToast(u.activo ? `${u.nombre} desactivado` : `${u.nombre} reactivado`, 'success')
    } catch (err) {
      showToast(err.message || 'No se pudo cambiar el estado', 'error')
    }
  }

  async function guardarPin(u) {
    const largoPin = longitudPin(u.rol)
    if (nuevoPin.length !== largoPin) return showToast(`El PIN debe ser de ${largoPin} dígitos`, 'error')
    if (nuevoPin !== confirmarPin) return showToast('La confirmación no coincide con el nuevo PIN', 'error')
    try {
      await cambiarPin.mutateAsync({ id: u.id, pin: nuevoPin })
      setPinPara(null); setNuevoPin(''); setConfirmarPin('')
      showToast(`PIN de ${u.nombre} actualizado`, 'success')
    } catch (err) {
      showToast(err.message || 'No se pudo actualizar el PIN', 'error')
    }
  }

  async function guardarRol(u) {
    try {
      await cambiarRol.mutateAsync({ id: u.id, rol: rolNuevo })
      setRolPara(null)
      showToast(`Rol de ${u.nombre} actualizado`, 'success')
    } catch (err) {
      showToast(err.message || 'No se pudo cambiar el rol', 'error')
    }
  }

  async function guardarNombre(u) {
    const limpio = nombreNuevo.trim().replace(/\s+/g, ' ')
    if (limpio.length < 3) return showToast('El nombre debe tener al menos 3 caracteres', 'error')
    try {
      await cambiarNombre.mutateAsync({ id: u.id, nombre: limpio })
      setNombrePara(null)
      showToast(`Nombre de ${u.nombre} actualizado a ${limpio}`, 'success')
    } catch (err) {
      showToast(err.message || 'No se pudo cambiar el nombre', 'error')
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Usuarios del sistema" ariaLabel="Gestión de usuarios" className="sm:max-w-lg">
      <div className="space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed flex items-start gap-2">
          <ShieldCheck size={14} className="shrink-0 mt-0.5 text-emerald-600" />
          <span>
            Los PIN se guardan cifrados (nunca en texto plano) y toda acción queda registrada en auditoría.
            Desactivar un usuario no borra su historial: se puede reactivar cuando quieras.
          </span>
        </p>

        <CrearUsuarioForm onCrear={campos => crear.mutateAsync(campos)} pending={crear.isPending} />

        <section aria-label="Lista de usuarios" className="space-y-2">
          {isLoading && (
            <p className="text-sm text-slate-500 flex items-center gap-2 py-4 justify-center">
              <Loader2 size={16} className="animate-spin" /> Cargando usuarios…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm font-semibold text-red-600 py-2">
              {error.message || 'No se pudieron cargar los usuarios'}
            </p>
          )}
          {!isLoading && !error && usuarios.map(u => (
            <article
              key={u.id}
              className={`rounded-xl border p-3 ${u.activo ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-80'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 truncate">
                    {u.nombre}
                    <span className={`ml-2 text-[10px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 align-middle ${u.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {etiquetaRol(u.rol)} · {u.tiene_pin ? 'con PIN' : 'sin PIN'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setNombrePara(nombrePara === u.id ? null : u.id); setNombreNuevo(u.nombre) }}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-300 text-slate-600"
                    title="Cambiar nombre"
                    aria-label={`Cambiar nombre de ${u.nombre}`}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPinPara(pinPara === u.id ? null : u.id); setNuevoPin(''); setConfirmarPin('') }}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-300 text-slate-600"
                    title={u.tiene_pin ? 'Restablecer PIN' : 'Asignar PIN'}
                    aria-label={`${u.tiene_pin ? 'Restablecer' : 'Asignar'} PIN de ${u.nombre}`}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRolPara(rolPara === u.id ? null : u.id); setRolNuevo(u.rol) }}
                    disabled={!u.activo}
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-slate-300 text-slate-600 disabled:opacity-40"
                    title="Cambiar rol"
                    aria-label={`Cambiar rol de ${u.nombre}`}
                  >
                    <UserCog size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleEstado(u)}
                    disabled={cambiarEstado.isPending || esPropio(u)}
                    className={`min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border ${u.activo ? 'border-rose-200 text-rose-600' : 'border-emerald-200 text-emerald-600'}`}
                    title={esPropio(u) ? 'No puedes desactivar tu propio usuario' : (u.activo ? 'Desactivar usuario' : 'Reactivar usuario')}
                    aria-label={esPropio(u) ? 'No puedes desactivar tu propio usuario' : `${u.activo ? 'Desactivar' : 'Reactivar'} a ${u.nombre}`}
                  >
                    {u.activo ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
                  </button>
                </div>
              </div>

              {nombrePara === u.id && (
                <div className="mt-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                  <label className="block flex-1">
                    <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nuevo nombre</span>
                    <input
                      value={nombreNuevo}
                      onChange={e => setNombreNuevo(e.target.value)}
                      placeholder="Ej: María Pérez"
                      maxLength={60}
                      disabled={cambiarNombre.isPending}
                      className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-800"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => guardarNombre(u)}
                    disabled={cambiarNombre.isPending}
                    className="min-h-11 rounded-xl bg-primary px-4 py-2 font-bold text-white disabled:opacity-60"
                  >
                    Guardar nombre
                  </button>
                </div>
              )}

              {pinPara === u.id && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:items-end">
                  <label className="block">
                    <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nuevo PIN ({longitudPin(u.rol)} dígitos)</span>
                    <PinInput value={nuevoPin} onChange={setNuevoPin} disabled={cambiarPin.isPending} length={longitudPin(u.rol)} />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Confirmar nuevo PIN</span>
                    <PinInput value={confirmarPin} onChange={setConfirmarPin} disabled={cambiarPin.isPending} length={longitudPin(u.rol)} />
                  </label>
                  <button
                    type="button"
                    onClick={() => guardarPin(u)}
                    disabled={cambiarPin.isPending}
                    className="min-h-11 rounded-xl bg-primary px-4 py-2 font-bold text-white disabled:opacity-60 sm:col-span-2"
                  >
                    Guardar PIN
                  </button>
                </div>
              )}

              {rolPara === u.id && (
                <div className="mt-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                  <label className="block flex-1">
                    <span className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nuevo rol</span>
                    <CustomSelect
                      options={opcionesConActual(u.rol)}
                      value={rolNuevo}
                      onChange={v => setRolNuevo(v)}
                      placeholder="Selecciona el nuevo rol"
                      showSubInTrigger={false}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => guardarRol(u)}
                    disabled={cambiarRol.isPending || rolNuevo === u.rol}
                    className="min-h-11 rounded-xl bg-primary px-4 py-2 font-bold text-white disabled:opacity-60"
                  >
                    Guardar rol
                  </button>
                </div>
              )}
            </article>
          ))}
          {!isLoading && !error && usuarios.length === 0 && (
            <p className="text-sm text-slate-500 py-4 text-center">
              <Users size={16} className="inline mr-1" /> No hay usuarios operativos todavía. Crea el primero arriba.
            </p>
          )}
        </section>
      </div>
    </Modal>
  )
}
