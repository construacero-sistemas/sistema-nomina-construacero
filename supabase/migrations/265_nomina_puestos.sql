-- 265_nomina_puestos.sql
-- Puestos de trabajo personalizados de la cuenta: aparecen como botones en
-- «Cargo u ocupación» de la ficha del empleado (además de los fijos y de los
-- cargos que ya usa alguien). Lista JSON de textos, sin repetir.
-- Idempotente. Si aún no se aplica, el Worker omite la columna al guardar
-- (reintento sin columnas faltantes) y la ficha sigue funcionando.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_puestos JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'config_nomina_puestos_lista'
                 AND conrelid = 'public.configuracion_negocio'::regclass) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT config_nomina_puestos_lista CHECK (jsonb_typeof(nomina_puestos) = 'array');
  END IF;
END $$;
