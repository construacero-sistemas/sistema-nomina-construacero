-- Guardarraíl de saldo: ningún cambio en el libro puede dejar una cartera de
-- custodia en negativo (egreso nuevo, cambio de monto/cartera/moneda, anular un
-- ingreso o revertir la anulación de un egreso). Usa el saldo actual, igual que
-- las transferencias (244). Solo se evalúan las filas modificadas: un saldo ya
-- negativo no se toca, pero bloquea nuevas reducciones hasta corregirlo.
BEGIN;

CREATE OR REPLACE FUNCTION public.finanzas_aporte_saldo(p_tipo TEXT, p_monto NUMERIC, p_estado TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_estado <> 'activo' THEN 0 WHEN p_tipo = 'ingreso' THEN p_monto ELSE -p_monto END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_guard_saldo_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_wallet UUID;
  v_currency TEXT;
  v_delta NUMERIC;
  v_balance NUMERIC;
  v_available NUMERIC;
  v_shortfall NUMERIC;
  v_i INT;
BEGIN
  -- El trigger de 238 serializa todos los cambios al ledger antes de cada
  -- statement. Toma también el lock de 251 para compartir exclusión con su guard.
  PERFORM pg_advisory_xact_lock(238, 1);
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.cuenta_id::text, 251));

  FOR v_i IN 1..2 LOOP
    IF v_i = 1 THEN
      v_wallet := NEW.cuenta_custodia_id; v_currency := NEW.moneda;
    ELSIF TG_OP = 'UPDATE' AND (OLD.cuenta_custodia_id IS DISTINCT FROM NEW.cuenta_custodia_id OR OLD.moneda <> NEW.moneda) THEN
      v_wallet := OLD.cuenta_custodia_id; v_currency := OLD.moneda;
    ELSE
      EXIT;
    END IF;
    CONTINUE WHEN v_wallet IS NULL;

    v_delta := 0;
    IF NEW.cuenta_custodia_id IS NOT DISTINCT FROM v_wallet AND NEW.moneda = v_currency THEN
      v_delta := v_delta + public.finanzas_aporte_saldo(NEW.tipo, NEW.monto, NEW.estado);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.cuenta_custodia_id IS NOT DISTINCT FROM v_wallet AND OLD.moneda = v_currency THEN
      v_delta := v_delta - public.finanzas_aporte_saldo(OLD.tipo, OLD.monto, OLD.estado);
    END IF;
    CONTINUE WHEN v_delta >= 0;

    SELECT coalesce(sum(public.finanzas_aporte_saldo(m.tipo, m.monto, m.estado)), 0) INTO v_balance
      FROM public.finanzas_movimientos m
      WHERE m.cuenta_id = NEW.cuenta_id AND m.cuenta_custodia_id = v_wallet AND m.moneda = v_currency AND m.estado = 'activo';

    v_available := v_balance - v_delta;
    v_shortfall := -v_balance;
    IF v_balance < 0 THEN
      RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = 'PT402',
        DETAIL = 'FINANCIAL_INSUFFICIENT_FUNDS',
        HINT = json_build_object('disponible', round(v_available, 6), 'faltante', round(v_shortfall, 6), 'moneda', v_currency)::text;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS finanzas_saldo_guard_insert ON public.finanzas_movimientos;
DROP TRIGGER IF EXISTS finanzas_saldo_guard_update ON public.finanzas_movimientos;
CREATE TRIGGER finanzas_saldo_guard_insert
AFTER INSERT ON public.finanzas_movimientos
FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_saldo_movement();
CREATE TRIGGER finanzas_saldo_guard_update
AFTER UPDATE OF cuenta_custodia_id,tipo,moneda,monto,estado ON public.finanzas_movimientos
FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_saldo_movement();

REVOKE ALL ON FUNCTION public.finanzas_guard_saldo_movement() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
