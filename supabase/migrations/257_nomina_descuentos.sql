-- supabase/migrations/257_nomina_descuentos.sql
-- Descuentos por trabajador en la liquidación, con motivo obligatorio.
--
-- Regla vigente: todo descuento de nómina se registra con motivo de la lista
-- cerrada (Anticipo, Préstamo, Falta, Multa u Otro), monto estrictamente
-- positivo y detalle opcional. El neto nunca queda negativo: el servidor
-- rechaza el conjunto que supere el bruto del recibo. El recibo imprime cada
-- descuento con su motivo.
--
-- Los totales del recibo siguen viviendo en nomina_lineas (deducciones_usd,
-- nota_deducciones); esta tabla es el desglose con autor y motivo. Las líneas
-- anteriores a esta migración conservan su deducción global sin desglose y el
-- recibo las imprime con el resumen histórico (nota_deducciones).

BEGIN;

CREATE TABLE IF NOT EXISTS public.nomina_descuentos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linea_id           UUID NOT NULL REFERENCES public.nomina_lineas(id) ON DELETE CASCADE,
  periodo_id         UUID NOT NULL REFERENCES public.nomina_periodos(id) ON DELETE CASCADE,
  motivo             TEXT NOT NULL CHECK (motivo IN ('anticipo', 'prestamo', 'falta', 'multa', 'otro')),
  detalle            TEXT CHECK (detalle IS NULL OR char_length(detalle) <= 180),
  monto_usd          NUMERIC(12,4) NOT NULL CHECK (monto_usd > 0),
  cuenta_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_por         UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_por_nombre  TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nomina_descuentos_linea
  ON public.nomina_descuentos(linea_id);
CREATE INDEX IF NOT EXISTS idx_nomina_descuentos_periodo
  ON public.nomina_descuentos(periodo_id, linea_id);

ALTER TABLE public.nomina_descuentos ENABLE ROW LEVEL SECURITY;

-- Doble compuerta como en el resto del módulo: aislamiento por tenant
-- restrictivo (nunca se cruza de cuenta) y escritura reservada a la capacidad
-- que ajusta recibos (la misma que gatea nomina/lineas/ajustar en el Worker).
DROP POLICY IF EXISTS nomina_descuentos_tenant_restrictive ON public.nomina_descuentos;
CREATE POLICY nomina_descuentos_tenant_restrictive ON public.nomina_descuentos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

DROP POLICY IF EXISTS nomina_descuentos_ajuste ON public.nomina_descuentos;
CREATE POLICY nomina_descuentos_ajuste ON public.nomina_descuentos
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('gestionarUsuarios')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('gestionarUsuarios')));

COMMENT ON TABLE public.nomina_descuentos IS 'Desglose de descuentos por recibo con motivo obligatorio (anticipo, prestamo, falta, multa, otro).';
COMMENT ON COLUMN public.nomina_descuentos.motivo IS 'Motivo obligatorio del descuento: anticipo, prestamo, falta, multa u otro.';
COMMENT ON COLUMN public.nomina_descuentos.monto_usd IS 'Monto del descuento en USD; siempre mayor que 0.';

COMMIT;
