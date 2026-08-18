-- supabase/migrations/211_nomina_lineas.sql
-- Una línea por empleado por período. Es el "recibo" calculado.

CREATE TABLE IF NOT EXISTS public.nomina_lineas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id           UUID NOT NULL REFERENCES public.nomina_periodos(id) ON DELETE RESTRICT,
  empleado_id          UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  cargo_snap           TEXT,
  salario_dia_usd_snap NUMERIC(12,4),
  horas_jornada_snap   NUMERIC(4,2),
  dias_trabajados      NUMERIC(4,1) NOT NULL DEFAULT 0,
  horas_normales       NUMERIC(6,2) NOT NULL DEFAULT 0,
  horas_extra          NUMERIC(6,2) NOT NULL DEFAULT 0,
  dias_sabado          INTEGER      NOT NULL DEFAULT 0,
  dias_feriado         INTEGER      NOT NULL DEFAULT 0,
  dias_ausencia        INTEGER      NOT NULL DEFAULT 0,
  monto_normal_usd     NUMERIC(12,4) NOT NULL DEFAULT 0,
  monto_extra_usd      NUMERIC(12,4) NOT NULL DEFAULT 0,
  monto_sabado_usd     NUMERIC(12,4) NOT NULL DEFAULT 0,
  monto_feriado_usd    NUMERIC(12,4) NOT NULL DEFAULT 0,
  bonos_usd            NUMERIC(12,4) NOT NULL DEFAULT 0,
  deducciones_usd      NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_bruto_usd      NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_neto_usd       NUMERIC(12,4) NOT NULL DEFAULT 0,
  nota_bonos           TEXT,
  nota_deducciones     TEXT,
  pagado               BOOLEAN NOT NULL DEFAULT false,
  pagado_en            TIMESTAMPTZ,
  pagado_por           UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  pagado_por_nombre    TEXT,
  referencia_pago      TEXT,
  cuenta_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(periodo_id, empleado_id)
);

CREATE INDEX IF NOT EXISTS idx_nomina_lineas_periodo
  ON public.nomina_lineas(periodo_id);
CREATE INDEX IF NOT EXISTS idx_nomina_lineas_empleado
  ON public.nomina_lineas(empleado_id, creado_en DESC);

ALTER TABLE public.nomina_lineas ENABLE ROW LEVEL SECURITY;
