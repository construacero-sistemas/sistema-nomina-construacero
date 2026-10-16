-- Guardarraíl de duplicados para el libro financiero.
-- La clave de comparación es tenant + día + cuenta de custodia + tipo + moneda +
-- concepto + referencia. El monto distingue bloqueo exacto de coincidencia justificable.
BEGIN;

ALTER TABLE public.finanzas_movimientos
  ADD COLUMN IF NOT EXISTS motivo_coincidencia TEXT
    CHECK (motivo_coincidencia IS NULL OR char_length(btrim(motivo_coincidencia)) BETWEEN 8 AND 300);

CREATE OR REPLACE FUNCTION public.finanzas_normalizar_clave_duplicado(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT regexp_replace(
    translate(lower(btrim(coalesce(p_texto, ''))), 'áàäâãåéèëêíìïîóòöôõúùüûñ', 'aaaaaaeeeeiiiiooooouuuun'),
    '[[:space:]]+', ' ', 'g'
  );
$$;

CREATE OR REPLACE FUNCTION public.finanzas_guard_duplicate_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_exact_exists BOOLEAN;
  v_similar_exists BOOLEAN;
BEGIN
  IF NEW.estado = 'activo' AND NEW.cuenta_custodia_id IS NOT NULL AND NEW.referencia IS NOT NULL THEN
    -- Serializa todos los escritores del tenant antes de buscar e insertar.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.cuenta_id::text, 251));

    SELECT
      coalesce(bool_or(m.monto = NEW.monto), false),
      coalesce(bool_or(m.monto <> NEW.monto AND public.finanzas_normalizar_clave_duplicado(m.concepto) = public.finanzas_normalizar_clave_duplicado(NEW.concepto)), false)
    INTO v_exact_exists, v_similar_exists
    FROM public.finanzas_movimientos m
    WHERE m.cuenta_id = NEW.cuenta_id
      AND m.cuenta_custodia_id = NEW.cuenta_custodia_id
      AND m.fecha = NEW.fecha
      AND m.tipo = NEW.tipo
      AND m.moneda = NEW.moneda
      AND public.finanzas_normalizar_clave_duplicado(m.referencia) = public.finanzas_normalizar_clave_duplicado(NEW.referencia)
      AND m.estado = 'activo'
      AND (TG_OP = 'INSERT' OR m.id <> NEW.id);

    IF v_exact_exists THEN
      RAISE EXCEPTION 'Exact active financial duplicate' USING ERRCODE = 'PT409', DETAIL = 'FINANCIAL_DUPLICATE_EXACT';
    END IF;
    IF v_similar_exists AND char_length(btrim(coalesce(NEW.motivo_coincidencia, ''))) NOT BETWEEN 8 AND 300 THEN
      RAISE EXCEPTION 'Similar active financial movement requires a reason' USING ERRCODE = 'PT409', DETAIL = 'FINANCIAL_DUPLICATE_SIMILAR';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finanzas_duplicate_guard ON public.finanzas_movimientos;
CREATE TRIGGER finanzas_duplicate_guard
BEFORE INSERT OR UPDATE OF cuenta_id,cuenta_custodia_id,fecha,tipo,concepto,moneda,monto,referencia,estado,motivo_coincidencia
ON public.finanzas_movimientos
FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_duplicate_movement();

REVOKE ALL ON FUNCTION public.finanzas_guard_duplicate_movement() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finanzas_normalizar_clave_duplicado(TEXT) TO service_role;

COMMIT;
