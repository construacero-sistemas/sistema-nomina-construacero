-- El motor nuevo permanece apagado hasta completar backfill, conciliación y
-- aprobación contable por cuenta.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_v2_enabled BOOLEAN NOT NULL DEFAULT false;
