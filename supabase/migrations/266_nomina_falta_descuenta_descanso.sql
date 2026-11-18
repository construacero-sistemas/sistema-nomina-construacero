-- 266: cada falta descuenta un día de descanso pagado desde la primera falta.
--
-- Regla del usuario (18/11/2026): «si falta 1 día se descuenta del día de
-- descanso». El cálculo (server/lib/nominaDescanso.js) ahora descuenta un
-- descanso pagado por cada falta de la semana a partir del umbral
-- `nomina_faltas_pierde_descanso`; el umbral de la empresa pasa de 2 (art. 119)
-- a 1. Solo se cambian las cuentas que conservaban el valor anterior por
-- defecto (2); quien ya lo había ajustado a mano conserva su valor.

ALTER TABLE public.configuracion_negocio
  ALTER COLUMN nomina_faltas_pierde_descanso SET DEFAULT 1;

UPDATE public.configuracion_negocio
   SET nomina_faltas_pierde_descanso = 1
 WHERE nomina_faltas_pierde_descanso = 2;

COMMENT ON COLUMN public.configuracion_negocio.nomina_faltas_pierde_descanso IS
  'Faltas en una semana desde las que cada falta descuenta un día de descanso pagado (empresa: 1; LOTTT art. 119: 2). 0 = nunca se descuenta.';
