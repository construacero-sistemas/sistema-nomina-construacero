-- 249_nomina_tasas_trazabilidad.sql
-- Trazabilidad de la tasa manual: quién la fijó, cuándo y con qué motivo.
-- La tasa manual deja de vivir solo en el navegador del operador: se registra
-- aquí (fuente = 'MANUAL', periodo_id NULL) y todos los navegadores leen el
-- mismo valor. Las columnas son NULL para los snapshots históricos.

ALTER TABLE public.nomina_tasas_snapshot
  ADD COLUMN IF NOT EXISTS motivo TEXT,
  ADD COLUMN IF NOT EXISTS fijada_por_nombre TEXT;

COMMENT ON COLUMN public.nomina_tasas_snapshot.motivo IS
  'Motivo declarado al fijar una tasa manual (trazabilidad operativa)';
COMMENT ON COLUMN public.nomina_tasas_snapshot.fijada_por_nombre IS
  'Nombre del operador que fijó la tasa al momento del registro';
