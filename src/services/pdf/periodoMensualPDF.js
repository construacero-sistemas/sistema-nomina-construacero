// src/services/pdf/periodoMensualPDF.js
// Dynamic import wrapper to load jspdf only when generating the report
export async function generarPeriodoMensualPDF(args) {
  const { generarPeriodoMensualPDFImpl } = await import('./periodoMensualPDF.impl.js')
  return generarPeriodoMensualPDFImpl(args)
}
