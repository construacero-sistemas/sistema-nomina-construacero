-- Marcaje operativo realizado por logística con hora del servidor.

ALTER TABLE public.registro_asistencia
  ADD COLUMN IF NOT EXISTS estado_marcaje TEXT NOT NULL DEFAULT 'manual'
    CHECK (estado_marcaje IN ('manual','entrada','completo','corregido')),
  ADD COLUMN IF NOT EXISTS entrada_marcada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS salida_marcada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entrada_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS salida_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entrada_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS salida_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_asistencia_entrada_idempotency
  ON public.registro_asistencia(cuenta_id, entrada_idempotency_key)
  WHERE entrada_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_asistencia_salida_idempotency
  ON public.registro_asistencia(cuenta_id, salida_idempotency_key)
  WHERE salida_idempotency_key IS NOT NULL;
