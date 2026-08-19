// server/handlers/nomina.js
// Barrel público de Nómina: conserva las rutas existentes y mantiene cada dominio
// en un módulo menor de 600 líneas.
export {
  handleGetEmpleados,
  handleGetConfigEmpleados,
  handleCrearConfigEmpleado,
  handleActualizarConfigEmpleado,
} from './nomina.empleados.js'

export {
  handleGetAsistencia,
  handleGetMarcajeHoy,
  handleMarcarEntrada,
  handleMarcarSalida,
  handleGetFeriados,
  handleCrearFeriado,
  handleGetHorarios,
  handleCrearHorario,
  validarFeriadoSolicitado,
} from './nomina.asistencia.js'

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
  handleGetReglasLegales,
  handleCrearReglaLegal,
} from './nomina.catalogos.js'

export {
  handleGetPeriodos,
  handleCrearPeriodo,
  handleCalcularPeriodo,
  handleCerrarPeriodo,
  handleReabrirPeriodo,
} from './nomina.periodos.js'

export {
  handleGetLineas,
  handleAjustarLinea,
  handlePagarLineas,
  handleRevertirPagoLinea,
} from './nomina.lineas.js'
