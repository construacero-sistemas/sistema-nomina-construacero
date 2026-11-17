-- 262_nomina_descanso_remunerado.sql
-- Descanso semanal y feriados remunerados (LOTTT, art. 119).
--
-- El cálculo del período paga, con el salario diario, los días de descanso de
-- cada persona (los que no trabaja según su semana; el domingo siempre) y los
-- feriados no laborables, aunque no los trabaje. Solo los pierde en la semana en
-- que faltó dos o más días hábiles.
--
-- El dinero va dentro de `monto_normal_usd` (salario diario × días), así que los
-- recálculos del total que suman conceptos (ajuste de descuentos, comisiones)
-- siguen cuadrando sin cambios. Esta columna solo guarda CUÁNTOS de esos días son
-- de descanso, para mostrarlo en el recibo.
--
-- Idempotente. El Worker tolera que aún no exista (guarda sin el conteo).

ALTER TABLE public.nomina_lineas
  ADD COLUMN IF NOT EXISTS dias_descanso NUMERIC(5,1) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_lineas_dias_descanso_no_negativo'
      AND conrelid = 'public.nomina_lineas'::regclass
  ) THEN
    ALTER TABLE public.nomina_lineas
      ADD CONSTRAINT nomina_lineas_dias_descanso_no_negativo CHECK (dias_descanso >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.nomina_lineas.dias_descanso IS
  'Días de descanso y feriados pagados sin trabajarse (LOTTT art. 119). Su pago ya está incluido en monto_normal_usd = salario diario × (días trabajados normales + dias_descanso).';
