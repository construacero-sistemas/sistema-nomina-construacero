-- 221_finanzas_movimientos.sql
-- Ingresos/egresos financieros con precisión decimal, tenant y anulación auditada.

CREATE TABLE IF NOT EXISTS public.finanzas_categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL CHECK (char_length(trim(nombre)) BETWEEN 1 AND 80),
  tipo        TEXT NOT NULL DEFAULT 'ambos' CHECK (tipo IN ('ingreso', 'egreso', 'ambos')),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cuenta_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_finanzas_categorias_cuenta_activo
  ON public.finanzas_categorias(cuenta_id, activo, nombre);

CREATE TABLE IF NOT EXISTS public.finanzas_movimientos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha              DATE NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  categoria          TEXT NOT NULL CHECK (char_length(trim(categoria)) BETWEEN 1 AND 80),
  concepto           TEXT NOT NULL CHECK (char_length(trim(concepto)) BETWEEN 1 AND 180),
  monto              NUMERIC(18,6) NOT NULL CHECK (monto > 0 AND monto <= 1000000000),
  moneda             TEXT NOT NULL CHECK (moneda IN ('USD', 'VES', 'EUR', 'USDT')),
  tasa_ves           NUMERIC(24,8) NOT NULL CHECK (tasa_ves > 0 AND tasa_ves <= 1000000),
  monto_ves          NUMERIC(24,6) GENERATED ALWAYS AS (round(monto * tasa_ves, 6)) STORED,
  fuente_tasa        TEXT NOT NULL CHECK (fuente_tasa IN ('BCV', 'EURO', 'USDT', 'MANUAL')),
  observacion_tasa   TEXT,
  tasa_observada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  referencia         TEXT CHECK (referencia IS NULL OR char_length(referencia) <= 160),
  observaciones      TEXT CHECK (observaciones IS NULL OR char_length(observaciones) <= 1000),
  idempotency_key    TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  estado             TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'anulado')),
  anulado_en         TIMESTAMPTZ,
  anulado_por        UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  motivo_anulacion   TEXT CHECK (motivo_anulacion IS NULL OR char_length(trim(motivo_anulacion)) BETWEEN 1 AND 300),
  creado_por         UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fuente_tasa <> 'MANUAL' OR char_length(trim(coalesce(observacion_tasa, ''))) > 0),
  CHECK ((estado = 'activo' AND anulado_en IS NULL AND anulado_por IS NULL) OR
         (estado = 'anulado' AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_finanzas_movimiento_idempotency
  ON public.finanzas_movimientos(cuenta_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_finanzas_movimientos_cuenta_fecha
  ON public.finanzas_movimientos(cuenta_id, fecha DESC, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_finanzas_movimientos_cuenta_tipo_estado
  ON public.finanzas_movimientos(cuenta_id, tipo, estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_finanzas_movimientos_cuenta_categoria
  ON public.finanzas_movimientos(cuenta_id, categoria, fecha DESC);

ALTER TABLE public.finanzas_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finanzas_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finanzas_categorias_tenant_restrictive ON public.finanzas_categorias;
CREATE POLICY finanzas_categorias_tenant_restrictive ON public.finanzas_categorias
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());
DROP POLICY IF EXISTS finanzas_categorias_admin_all ON public.finanzas_categorias;
CREATE POLICY finanzas_categorias_admin_all ON public.finanzas_categorias
  FOR ALL TO authenticated
  USING (get_rol_actual() = 'administracion')
  WITH CHECK (get_rol_actual() = 'administracion');

DROP POLICY IF EXISTS finanzas_movimientos_tenant_restrictive ON public.finanzas_movimientos;
CREATE POLICY finanzas_movimientos_tenant_restrictive ON public.finanzas_movimientos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());
DROP POLICY IF EXISTS finanzas_movimientos_admin_all ON public.finanzas_movimientos;
CREATE POLICY finanzas_movimientos_admin_all ON public.finanzas_movimientos
  FOR ALL TO authenticated
  USING (get_rol_actual() = 'administracion')
  WITH CHECK (get_rol_actual() = 'administracion');

CREATE OR REPLACE FUNCTION public.finanzas_resumen(
  p_cuenta_id UUID,
  p_desde DATE,
  p_hasta DATE,
  p_moneda TEXT DEFAULT NULL,
  p_tipo TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL
)
RETURNS TABLE(
  tipo TEXT,
  categoria TEXT,
  total_ves NUMERIC,
  movimientos BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.tipo, m.categoria,
         round(sum(m.monto_ves), 6) AS total_ves,
         count(*)::BIGINT AS movimientos
  FROM public.finanzas_movimientos m
  WHERE m.cuenta_id = p_cuenta_id
    AND m.estado = 'activo'
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND (p_moneda IS NULL OR m.moneda = p_moneda)
    AND (p_tipo IS NULL OR m.tipo = p_tipo)
    AND (p_categoria IS NULL OR m.categoria = p_categoria)
  GROUP BY m.tipo, m.categoria
  ORDER BY m.tipo, m.categoria;
$$;

REVOKE ALL ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON TABLE public.finanzas_movimientos IS
  'Libro de ingresos y egresos por tenant; los movimientos no se borran, se anulan.';
COMMENT ON COLUMN public.finanzas_movimientos.monto_ves IS
  'Total calculado por PostgreSQL: monto multiplicado por tasa_ves.';
COMMENT ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) IS
  'Agregado server-side para reducir egress; solo el Worker service-role debe invocarlo.';
