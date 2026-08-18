-- Snapshots de conversión usados por liquidación; nunca se recalculan con tasa actual.

CREATE TABLE IF NOT EXISTS public.nomina_tasas_snapshot (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           DATE NOT NULL,
  moneda_origen   TEXT NOT NULL CHECK (moneda_origen IN ('USD','EUR','USDT','VES')),
  moneda_destino  TEXT NOT NULL DEFAULT 'VES' CHECK (moneda_destino = 'VES'),
  valor           NUMERIC(18,8) NOT NULL CHECK (valor > 0),
  fuente          TEXT NOT NULL,
  observado_en   TIMESTAMPTZ NOT NULL,
  aprobado        BOOLEAN NOT NULL DEFAULT false,
  aprobado_por    UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  periodo_id      UUID REFERENCES public.nomina_periodos(id) ON DELETE RESTRICT,
  cuenta_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_tasa_snapshot
  ON public.nomina_tasas_snapshot(cuenta_id, fecha, moneda_origen, fuente, periodo_id);
CREATE INDEX IF NOT EXISTS idx_nomina_tasas_cuenta_fecha
  ON public.nomina_tasas_snapshot(cuenta_id, fecha DESC, moneda_origen);

ALTER TABLE public.nomina_tasas_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomina_tasas_snapshot_tenant_restrictive ON public.nomina_tasas_snapshot;
CREATE POLICY nomina_tasas_snapshot_tenant_restrictive ON public.nomina_tasas_snapshot
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

DROP POLICY IF EXISTS nomina_tasas_snapshot_admin_all ON public.nomina_tasas_snapshot;
CREATE POLICY nomina_tasas_snapshot_admin_all ON public.nomina_tasas_snapshot
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'));
