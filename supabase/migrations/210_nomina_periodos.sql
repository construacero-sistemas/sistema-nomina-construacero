-- supabase/migrations/210_nomina_periodos.sql
-- Período de nómina (semanal, quincenal o mensual).

CREATE TABLE IF NOT EXISTS public.nomina_periodos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  desde       DATE NOT NULL,
  hasta       DATE NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'semanal'
              CHECK (tipo IN ('semanal','quincenal','mensual')),
  estado      TEXT NOT NULL DEFAULT 'abierto'
              CHECK (estado IN ('abierto','cerrado','pagado')),
  cerrado_en  TIMESTAMPTZ,
  cerrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cuenta_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hasta >= desde),
  UNIQUE(desde, hasta, cuenta_id)
);

CREATE INDEX IF NOT EXISTS idx_nomina_periodos_cuenta
  ON public.nomina_periodos(cuenta_id, creado_en DESC);

ALTER TABLE public.nomina_periodos ENABLE ROW LEVEL SECURITY;
