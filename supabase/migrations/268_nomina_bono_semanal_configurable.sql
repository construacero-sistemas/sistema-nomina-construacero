-- 268: bono semanal editable y guardado en cada recibo.
--
-- Regla del usuario (19/11/2026): el bono semanal sale de la semana (no se suma
-- al sueldo). Hasta ahora era $35 fijo en el código y se calculaba al abrir la
-- hoja, sin guardarse. Ahora:
--   1. `configuracion_negocio.nomina_bono_semanal_usd` (por defecto 35) se edita en
--      Configuración → «Reglas de pago y de la ley».
--   2. Al calcular el período, cada recibo guarda el bono y el sueldo semanal que le
--      tocaron (`nomina_lineas.bono_semanal_usd` y `sueldo_semanal_usd`), con el bono
--      multiplicado por las semanas del período (una quincena lleva dos bonos). Un
--      recibo pagado ya no cambia si luego se edita el bono.
--   Los recibos anteriores quedan en NULL: la hoja los sigue calculando con el bono
--   vigente, como antes.
--
-- Idempotente.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_bono_semanal_usd NUMERIC(10,2) NOT NULL DEFAULT 35;

ALTER TABLE public.nomina_lineas
  ADD COLUMN IF NOT EXISTS bono_semanal_usd NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS sueldo_semanal_usd NUMERIC(12,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuracion_negocio_bono_semanal_rango'
      AND conrelid = 'public.configuracion_negocio'::regclass
  ) THEN
    ALTER TABLE public.configuracion_negocio
      ADD CONSTRAINT configuracion_negocio_bono_semanal_rango
      CHECK (nomina_bono_semanal_usd >= 0 AND nomina_bono_semanal_usd <= 10000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_lineas_bono_sueldo_semanal_no_negativos'
      AND conrelid = 'public.nomina_lineas'::regclass
  ) THEN
    ALTER TABLE public.nomina_lineas
      ADD CONSTRAINT nomina_lineas_bono_sueldo_semanal_no_negativos
      CHECK ((bono_semanal_usd IS NULL OR bono_semanal_usd >= 0)
         AND (sueldo_semanal_usd IS NULL OR sueldo_semanal_usd >= 0));
  END IF;
END $$;

COMMENT ON COLUMN public.configuracion_negocio.nomina_bono_semanal_usd IS
  'Bono semanal en USD (por defecto 35). Sale de la semana (días trabajados + días pagados sin trabajar); no se suma al sueldo.';
COMMENT ON COLUMN public.nomina_lineas.bono_semanal_usd IS
  'Bono semanal que le tocó a este recibo al calcular el período (bono × semanas, nunca más que la semana). NULL = recibo anterior a la migración 268.';
COMMENT ON COLUMN public.nomina_lineas.sueldo_semanal_usd IS
  'Sueldo semanal de este recibo: la semana menos el bono. NULL = recibo anterior a la migración 268.';
