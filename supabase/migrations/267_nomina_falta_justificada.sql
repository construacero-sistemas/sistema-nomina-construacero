-- 267: faltas con o sin justificativo; la falta sin justificativo descuenta solo el día.
--
-- Regla del usuario (19/11/2026):
--   «a los empleados al faltar un día sin justificativo se les descuenta solo el
--    día que falten, no dos», y al marcar que no vino se elige si trae
--    justificativo o no. La falta con justificativo se paga.
--
-- 1. `registro_asistencia.ausencia_justificada`: solo tiene sentido en una
--    ausencia. El cálculo (server/lib/nominaUtils.js) paga ese día con el
--    salario diario y no lo cuenta como falta para el descanso.
-- 2. El umbral `nomina_faltas_pierde_descanso` pasa a 0 (nunca se descuenta un
--    descanso por faltar). Solo se cambian las cuentas que tenían el valor de la
--    regla anterior (1, migración 266); quien lo ajustó a otro número lo conserva.
--
-- Idempotente.

ALTER TABLE public.registro_asistencia
  ADD COLUMN IF NOT EXISTS ausencia_justificada BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.registro_asistencia.ausencia_justificada IS
  'Falta con justificativo (reposo, permiso…): el día se paga con el salario diario. Solo puede ser true si es_ausencia.';

-- Cualquier escritura que deje de ser ausencia limpia el justificativo, así
-- ninguna ruta (reloj, corrección, registro manual) deja un valor huérfano.
CREATE OR REPLACE FUNCTION public.registro_asistencia_limpiar_justificada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.es_ausencia IS DISTINCT FROM true THEN
    NEW.ausencia_justificada := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registro_asistencia_limpiar_justificada ON public.registro_asistencia;
CREATE TRIGGER trg_registro_asistencia_limpiar_justificada
  BEFORE INSERT OR UPDATE ON public.registro_asistencia
  FOR EACH ROW EXECUTE FUNCTION public.registro_asistencia_limpiar_justificada();

ALTER TABLE public.configuracion_negocio
  ALTER COLUMN nomina_faltas_pierde_descanso SET DEFAULT 0;

UPDATE public.configuracion_negocio
   SET nomina_faltas_pierde_descanso = 0
 WHERE nomina_faltas_pierde_descanso = 1;

COMMENT ON COLUMN public.configuracion_negocio.nomina_faltas_pierde_descanso IS
  'Faltas sin justificativo en una semana desde las que cada falta descuenta además un día de descanso pagado (empresa: 0 = nunca, solo se descuenta el día faltado; LOTTT art. 119: 2).';
