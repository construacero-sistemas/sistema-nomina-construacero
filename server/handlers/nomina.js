// server/handlers/nomina.js
// Barrel público de Nómina: conserva las rutas existentes y mantiene cada dominio
// en un módulo menor de 600 líneas.
export {
  handleGetEmpleados,
  handleGetConfigEmpleados,
  handleCrearConfigEmpleado,
  handleActualizarConfigEmpleado,
  handleEliminarConfigEmpleado,
} from './nomina.empleados.js'

export {
  handleGetAsistencia,
  handleGetMarcajeHoy,
  handleMarcarEntrada,
  handleMarcarSalida,
  handleCorregirMarcaje,
  handleGetFeriados,
  handleCrearFeriado,
  handleEliminarFeriado,
  handleGetHorarios,
  handleCrearHorario,
  validarFeriadoSolicitado,
} from './nomina.asistencia.js'

export {
  handleGuardarHorarioEmpleado,
  handleMarcarAusencia,
  handleAnularEntradaComoAusencia,
} from './nomina.horarios.js'

export { handleDeshacerMarcaje } from './nomina.marcaje-deshacer.js'

export { handleGetHojaSemanal } from './nomina.hoja.js'

export {
  handleRegistrarAsistencia,
  handleRegistrarAsistenciaMasivo,
  handleEliminarAsistencia,
} from './nomina.registro.js'

export {
  handleGetConceptos,
  handleCrearConcepto,
  handleGetTasasSnapshots,
  handleCrearTasaSnapshot,
  handleGetTasaManual,
  handleFijarTasaManual,
  handleGetReglasLegales,
  handleCrearReglaLegal,
} from './nomina.catalogos.js'

export {
  handleGetPeriodos,
  handleCrearPeriodo,
  handleAsegurarSemanaActual,
  handleCalcularPeriodo,
  handleCerrarPeriodo,
  handleReabrirPeriodo,
  handleEliminarPeriodo,
} from './nomina.periodos.js'

export {
  handleGetLineas,
  handleGetRecibosEmpleado,
  handleAjustarLinea,
  handlePagarLineas,
  handleRevertirPagoLinea,
} from './nomina.lineas.js'

export {
  handleListarPosVendedores,
  handlePreviewComisionesPos,
  handleAplicarComisionesPos,
} from './nomina.comisiones.js'

