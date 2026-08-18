-- Catálogo de conceptos y desglose por línea de nómina.

CREATE TABLE IF NOT EXISTS public.nomina_conceptos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('ingreso','deduccion','aporte_patronal','retencion')),
  imponible         BOOLEAN NOT NULL DEFAULT false,
  obligatorio       BOOLEAN NOT NULL DEFAULT false,
  moneda_default    TEXT NOT NULL DEFAULT 'VES' CHECK (moneda_default IN ('VES','USD','EUR','USDT')),
  formula_key       TEXT,
  fecha_desde       DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_hasta       DATE,
  activo            BOOLEAN NOT NULL DEFAULT true,
  cuenta_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_por        UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cuenta_id, codigo),
  CHECK (fecha_hasta IS NULL OR fecha_hasta >= fecha_desde)
);

CREATE TABLE IF NOT EXISTS public.nomina_linea_conceptos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linea_id        UUID NOT NULL REFERENCES public.nomina_lineas(id) ON DELETE RESTRICT,
  concepto_id     UUID REFERENCES public.nomina_conceptos(id) ON DELETE RESTRICT,
  codigo_snap     TEXT NOT NULL,
  nombre_snap     TEXT NOT NULL,
  tipo_snap       TEXT NOT NULL CHECK (tipo_snap IN ('ingreso','deduccion','aporte_patronal','retencion')),
  imponible_snap  BOOLEAN NOT NULL DEFAULT false,
  base_legal      NUMERIC(18,6) NOT NULL DEFAULT 0,
  monto           NUMERIC(18,6) NOT NULL DEFAULT 0,
  moneda          TEXT NOT NULL DEFAULT 'VES' CHECK (moneda IN ('VES','USD','EUR','USDT')),
  tasa_aplicada   NUMERIC(18,8),
  fuente_tasa     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  cuenta_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nomina_conceptos_cuenta_activo
  ON public.nomina_conceptos(cuenta_id, activo, fecha_desde);
CREATE INDEX IF NOT EXISTS idx_nomina_linea_conceptos_cuenta_linea
  ON public.nomina_linea_conceptos(cuenta_id, linea_id);

ALTER TABLE public.nomina_conceptos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomina_linea_conceptos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nomina_conceptos_tenant_restrictive ON public.nomina_conceptos;
CREATE POLICY nomina_conceptos_tenant_restrictive ON public.nomina_conceptos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());
DROP POLICY IF EXISTS nomina_linea_conceptos_tenant_restrictive ON public.nomina_linea_conceptos;
CREATE POLICY nomina_linea_conceptos_tenant_restrictive ON public.nomina_linea_conceptos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

DROP POLICY IF EXISTS nomina_conceptos_admin_all ON public.nomina_conceptos;
CREATE POLICY nomina_conceptos_admin_all ON public.nomina_conceptos
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'));
DROP POLICY IF EXISTS nomina_linea_conceptos_admin_all ON public.nomina_linea_conceptos;
CREATE POLICY nomina_linea_conceptos_admin_all ON public.nomina_linea_conceptos
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'));
