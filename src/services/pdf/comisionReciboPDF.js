// src/services/pdf/comisionReciboPDF.js
// Thin async wrapper: dynamically imports the jspdf-based implementation so the
// heavy PDF chunk is only fetched when a PDF export is actually requested.
export async function generarComisionReciboPDF(args) {
  const { generarComisionReciboPDFImpl } = await import('./comisionReciboPDF.impl.js')
  return generarComisionReciboPDFImpl(args)
}
