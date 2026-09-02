-- 226_finanzas_movimiento_origen_partes.sql
-- Permite atribuir cada movimiento a un método de pago y una cuenta de origen
-- concreta (ej. "Banco en Bolívares" → "Banesco"), y registrar el pago en
-- varios tramos ("cuántos egresos"), manteniendo compatibilidad con la
-- clasificación por texto anterior (columnas NULL = sin dato explícito).

ALTER TABLE public.finanzas_movimientos
  ADD COLUMN IF NOT EXISTS metodo_pago  TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_origen TEXT,
  ADD COLUMN IF NOT EXISTS partes       JSONB;

COMMENT ON COLUMN public.finanzas_movimientos.metodo_pago IS
  'Método de pago (Efectivo $, Zelle, USDT, Efectivo Bs, Banco en Bolívares, Transferencia, Pago Móvil, Punto de Venta).';
COMMENT ON COLUMN public.finanzas_movimientos.cuenta_origen IS
  'Cuenta/banco de origen concreto (ej. Banesco, BNC, Mercantil) para métodos de cartera Bs.';
COMMENT ON COLUMN public.finanzas_movimientos.partes IS
  'Array JSONB de tramos del movimiento cuando se pagó/cobró en varias partes. Cada tramo: { monto, moneda, referencia?, metodo_pago?, cuenta_origen? }';

-- Validación ligera de longitud (sin romper movimientos históricos con NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_finanzas_movimientos_metodo_pago_len'
  ) THEN
    ALTER TABLE public.finanzas_movimientos
      ADD CONSTRAINT chk_finanzas_movimientos_metodo_pago_len
      CHECK (metodo_pago IS NULL OR char_length(trim(metodo_pago)) BETWEEN 1 AND 60);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_finanzas_movimientos_cuenta_origen_len'
  ) THEN
    ALTER TABLE public.finanzas_movimientos
      ADD CONSTRAINT chk_finanzas_movimientos_cuenta_origen_len
      CHECK (cuenta_origen IS NULL OR char_length(trim(cuenta_origen)) BETWEEN 1 AND 80);
  END IF;
END $$;

-- Índice para contar egresos por cuenta de origen sin escaneo completo.
CREATE INDEX IF NOT EXISTS idx_finanzas_movimientos_cuenta_origen
  ON public.finanzas_movimientos(cuenta_id, cuenta_origen, tipo, estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_finanzas_movimientos_metodo
  ON public.finanzas_movimientos(cuenta_id, metodo_pago, tipo, estado, fecha DESC);
