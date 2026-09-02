// src/services/pdf/nominaReciboPDF.js
// Thin async wrapper: dynamically imports the jspdf-based implementation so the
// heavy PDF chunk is only fetched when a PDF export is actually requested.
export async function generarNominaReciboPDF(args) {
  const { generarNominaReciboPDFImpl } = await import('./nominaReciboPDF.impl.js')
  return generarNominaReciboPDFImpl(args)
}
