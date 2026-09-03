// src/services/pdf/finanzasResumenPDF.js
// Thin async wrapper: dynamically imports the jspdf-based implementation so the
// heavy PDF chunk is only fetched when a PDF export is actually requested.
export async function generarFinanzasResumenPDF(args) {
  const { generarFinanzasResumenPDFImpl } = await import('./finanzasResumenPDF.impl.js')
  return generarFinanzasResumenPDFImpl(args)
}
