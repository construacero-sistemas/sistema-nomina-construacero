-- supabase/migrations/209_nomina_asistencia.sql
-- Una fila por empleado por día. Los campos calculados son llenados por el Worker.

CREATE TABLE IF NOT EXISTS public.registro_asistencia (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id      UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  fecha            DATE NOT NULL,
  hora_entrada     TIME,
  hora_salida      TIME,
  horas_trabajadas NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (horas_trabajadas >= 0),
  horas_normales   NUMERIC(5,2) NOT NULL DEFAULT 0,
  horas_extra      NUMERIC(5,2) NOT NULL DEFAULT 0,
  es_sabado        BOOLEAN NOT NULL DEFAULT false,
  es_domingo       BOOLEAN NOT NULL DEFAULT false,
  es_feriado       BOOLEAN NOT NULL DEFAULT false,
  es_ausencia      BOOLEAN NOT NULL DEFAULT false,
  nota             TEXT,
  registrado_por   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cuenta_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(empleado_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_asistencia_empleado_fecha
  ON public.registro_asistencia(empleado_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asistencia_cuenta_fecha
  ON public.registro_asistencia(cuenta_id, fecha DESC);

ALTER TABLE public.registro_asistencia ENABLE ROW LEVEL SECURITY;
