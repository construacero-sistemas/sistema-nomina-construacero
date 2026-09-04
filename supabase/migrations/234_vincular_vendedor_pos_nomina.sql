-- supabase/migrations/234_vincular_vendedor_pos_nomina.sql
-- Vinculación de empleados de nómina con vendedores del POS e importación de comisiones.

-- 1. Agregar columna pos_vendedor_id a nomina_config_empleado
ALTER TABLE public.nomina_config_empleado
  ADD COLUMN IF NOT EXISTS pos_vendedor_id UUID;

CREATE INDEX IF NOT EXISTS idx_nomina_config_pos_vendedor
  ON public.nomina_config_empleado(pos_vendedor_id)
  WHERE pos_vendedor_id IS NOT NULL;

COMMENT ON COLUMN public.nomina_config_empleado.pos_vendedor_id
  IS 'UUID del usuario vendedor en el sistema POS (listo-pos-cotizaciones.usuarios)';

-- 2. Agregar columnas de comisiones POS a nomina_lineas
ALTER TABLE public.nomina_lineas
  ADD COLUMN IF NOT EXISTS comisiones_pos_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comisiones_despachos_ids JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.nomina_lineas.comisiones_pos_usd
  IS 'Monto acumulado de comisiones de ventas importadas del POS para este período';
COMMENT ON COLUMN public.nomina_lineas.comisiones_despachos_ids
  IS 'Lista de IDs de despachos o liberaciones de comisiones del POS liquidadas en este recibo';
