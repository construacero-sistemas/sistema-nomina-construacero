-- 225_nomina_montos_fijos.sql
-- Horas extra y sábados se pagan con montos fijos en USD configurables.
-- Convención del cálculo (server/lib/nominaUtils.js):
--  - nomina_monto_hora_extra_usd: monto fijo por CADA hora extra trabajada.
--  - nomina_monto_sabado_usd: monto fijo por sábado trabajado que SUSTITUYE el
--    pago completo del día (ese día deja de sumar salario diario + recargo).
--  - nomina_feriado_modo: 'factor' (salario diario × factor, comportamiento
--    histórico) o 'monto_fijo' (monto fijo por día feriado que sustituye el día).
-- NULL en un monto = sin monto fijo: el cálculo usa el factor como respaldo,
-- para que ninguna cuenta quede pagando 0 durante la transición.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_monto_hora_extra_usd NUMERIC(18,6)
    CHECK (nomina_monto_hora_extra_usd IS NULL OR nomina_monto_hora_extra_usd > 0),
  ADD COLUMN IF NOT EXISTS nomina_monto_sabado_usd NUMERIC(18,6)
    CHECK (nomina_monto_sabado_usd IS NULL OR nomina_monto_sabado_usd > 0),
  ADD COLUMN IF NOT EXISTS nomina_monto_feriado_usd NUMERIC(18,6)
    CHECK (nomina_monto_feriado_usd IS NULL OR nomina_monto_feriado_usd > 0),
  ADD COLUMN IF NOT EXISTS nomina_feriado_modo TEXT NOT NULL DEFAULT 'factor'
    CHECK (nomina_feriado_modo IN ('factor', 'monto_fijo'));

COMMENT ON COLUMN public.configuracion_negocio.nomina_monto_hora_extra_usd IS
  'Monto fijo USD por cada hora extra; si es NULL se usa nomina_factor_hora_extra.';
COMMENT ON COLUMN public.configuracion_negocio.nomina_monto_sabado_usd IS
  'Monto fijo USD por sábado trabajado que sustituye el pago del día; NULL = factor histórico.';
COMMENT ON COLUMN public.configuracion_negocio.nomina_monto_feriado_usd IS
  'Monto fijo USD por día feriado (solo con nomina_feriado_modo = monto_fijo).';
COMMENT ON COLUMN public.configuracion_negocio.nomina_feriado_modo IS
  'Modo de pago del feriado: factor multiplicador del salario o monto fijo por día.';
