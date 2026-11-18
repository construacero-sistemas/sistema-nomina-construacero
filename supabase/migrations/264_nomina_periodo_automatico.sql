-- 264_nomina_periodo_automatico.sql
-- Períodos de nómina automáticos (por defecto) o manuales, y día en que arranca
-- la semana. Por defecto la semana va de jueves a miércoles, como la planilla.
--   nomina_periodo_modo   'automatico' | 'manual'
--   nomina_semana_inicio  0 = domingo … 6 = sábado (4 = jueves)
-- Idempotente. El Worker usa estos mismos valores si la columna aún no existe.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_periodo_modo TEXT NOT NULL DEFAULT 'automatico',
  ADD COLUMN IF NOT EXISTS nomina_semana_inicio SMALLINT NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_nomina_periodo_modo_valido'
                 AND conrelid = 'public.configuracion_negocio'::regclass) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT config_nomina_periodo_modo_valido CHECK (nomina_periodo_modo IN ('automatico', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_nomina_semana_inicio_rango'
                 AND conrelid = 'public.configuracion_negocio'::regclass) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT config_nomina_semana_inicio_rango CHECK (nomina_semana_inicio BETWEEN 0 AND 6);
  END IF;
END $$;
