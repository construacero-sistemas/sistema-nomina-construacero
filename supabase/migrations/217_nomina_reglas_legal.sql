-- Reglas legales versionadas. No se insertan porcentajes por defecto.

CREATE TABLE IF NOT EXISTS public.nomina_reglas_legal (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('porcentaje','monto_fijo','formula')),
  valor           NUMERIC(18,8),
  unidad          TEXT NOT NULL CHECK (unidad IN ('porcentaje','VES','USD','factor','formula')),
  formula_key     TEXT,
  base_key        TEXT,
  fecha_desde     DATE NOT NULL,
  fecha_hasta     DATE,
  version         TEXT NOT NULL,
  fuente          TEXT NOT NULL,
  aprobado_por    UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  aprobado_en     TIMESTAMPTZ,
  activo          BOOLEAN NOT NULL DEFAULT false,
  cuenta_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_por      UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cuenta_id, codigo, version),
  CHECK (fecha_hasta IS NULL OR fecha_hasta >= fecha_desde),
  CHECK (tipo <> 'porcentaje' OR (valor IS NOT NULL AND valor >= 0 AND valor <= 100)),
  CHECK (tipo <> 'monto_fijo' OR valor IS NOT NULL),
  CHECK (tipo <> 'formula' OR formula_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_nomina_reglas_legal_vigencia
  ON public.nomina_reglas_legal(cuenta_id, codigo, fecha_desde, fecha_hasta, activo);

ALTER TABLE public.nomina_reglas_legal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomina_reglas_legal_tenant_restrictive ON public.nomina_reglas_legal;
CREATE POLICY nomina_reglas_legal_tenant_restrictive ON public.nomina_reglas_legal
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

DROP POLICY IF EXISTS nomina_reglas_legal_admin_all ON public.nomina_reglas_legal;
CREATE POLICY nomina_reglas_legal_admin_all ON public.nomina_reglas_legal
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'));
