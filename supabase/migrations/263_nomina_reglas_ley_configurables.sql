-- 263_nomina_reglas_ley_configurables.sql
-- Reglas de la ley laboral editables desde Configuración (por si cambia la ley).
--
-- Hasta ahora estos valores estaban fijos en el código. Los predeterminados son
-- los de la LOTTT vigente (Gaceta 6.076, 2012):
--   nomina_divisor_mensual         30        art. 113: salario diario = mensual ÷ 30
--   nomina_dias_laborables_default {1..5}    art. 173: máximo 5 días; sáb. y dom. de descanso
--   nomina_descanso_remunerado     true      art. 119: descanso y feriados se pagan
--   nomina_faltas_pierde_descanso  2         art. 119: faltar un día no quita el descanso
--                                            (0 = nunca se pierde)
-- Los factores y montos de hora extra, sábado y feriado ya eran columnas
-- (migraciones 001, 212 y 225); esta migración no los toca.
-- Idempotente. El Worker usa estos mismos valores si la columna aún no existe.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_divisor_mensual SMALLINT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS nomina_dias_laborables_default SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS nomina_descanso_remunerado BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nomina_faltas_pierde_descanso SMALLINT NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_nomina_divisor_mensual_rango'
                 AND conrelid = 'public.configuracion_negocio'::regclass) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT config_nomina_divisor_mensual_rango CHECK (nomina_divisor_mensual BETWEEN 1 AND 31);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_nomina_dias_laborables_validos'
                 AND conrelid = 'public.configuracion_negocio'::regclass) THEN
    -- Lunes (1) a sábado (6): el domingo nunca es laborable (art. 184, feriado).
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT config_nomina_dias_laborables_validos CHECK (
        cardinality(nomina_dias_laborables_default) BETWEEN 1 AND 6
        AND nomina_dias_laborables_default <@ ARRAY[1,2,3,4,5,6]::SMALLINT[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_nomina_faltas_descanso_rango'
                 AND conrelid = 'public.configuracion_negocio'::regclass) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT config_nomina_faltas_descanso_rango CHECK (nomina_faltas_pierde_descanso BETWEEN 0 AND 7);
  END IF;
END $$;

COMMENT ON COLUMN public.configuracion_negocio.nomina_divisor_mensual IS
  'Días entre los que se divide el sueldo mensual para obtener el diario (LOTTT art. 113: 30).';
COMMENT ON COLUMN public.configuracion_negocio.nomina_dias_laborables_default IS
  'Días laborables de quien no tiene semana propia: 1=lunes … 6=sábado (LOTTT art. 173: lunes a viernes).';
COMMENT ON COLUMN public.configuracion_negocio.nomina_descanso_remunerado IS
  'Si true, el cálculo paga los días de descanso y feriados no trabajados (LOTTT art. 119).';
COMMENT ON COLUMN public.configuracion_negocio.nomina_faltas_pierde_descanso IS
  'Faltas en una semana a partir de las cuales se pierde el descanso pagado (LOTTT art. 119: 2). 0 = nunca se pierde.';
