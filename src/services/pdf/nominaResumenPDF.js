// src/services/pdf/nominaResumenPDF.js
// Thin async wrapper: dynamically imports the jspdf-based implementation so the
// heavy PDF chunk is only fetched when a PDF export is actually requested.
export async function generarNominaResumenPDF(args) {
  const { generarNominaResumenPDFImpl } = await import('./nominaResumenPDF.impl.js')
  return generarNominaResumenPDFImpl(args)
}
