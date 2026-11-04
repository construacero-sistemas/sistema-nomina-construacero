-- Número correlativo único por movimiento (un solo contador para todo el libro).
--  * Los movimientos existentes se numeran por orden de registro (creado_en, id).
--  * Los nuevos reciben el siguiente número automáticamente; los huecos por rollback son
--    posibles (propio de las secuencias) pero un número nunca se repite ni se reutiliza.
--  * El número es inmutable: anular un movimiento no lo libera.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.finanzas_movimientos_numero_seq AS BIGINT;
ALTER TABLE public.finanzas_movimientos ADD COLUMN IF NOT EXISTS numero BIGINT;

-- Relleno de históricos: solo escribe la columna nueva, sin disparar las reglas del libro.
ALTER TABLE public.finanzas_movimientos DISABLE TRIGGER USER;
WITH orden AS (
  SELECT id, row_number() OVER (ORDER BY creado_en, id) AS n
  FROM public.finanzas_movimientos WHERE numero IS NULL
)
UPDATE public.finanzas_movimientos m
   SET numero = orden.n
  FROM orden WHERE orden.id = m.id;
ALTER TABLE public.finanzas_movimientos ENABLE TRIGGER USER;

SELECT setval('public.finanzas_movimientos_numero_seq',
  greatest((SELECT coalesce(max(numero), 0) FROM public.finanzas_movimientos), 1),
  (SELECT count(*) > 0 FROM public.finanzas_movimientos));
ALTER TABLE public.finanzas_movimientos
  ALTER COLUMN numero SET DEFAULT nextval('public.finanzas_movimientos_numero_seq'),
  ALTER COLUMN numero SET NOT NULL;
ALTER SEQUENCE public.finanzas_movimientos_numero_seq OWNED BY public.finanzas_movimientos.numero;
CREATE UNIQUE INDEX IF NOT EXISTS finanzas_movimientos_numero_uq ON public.finanzas_movimientos (numero);

CREATE OR REPLACE FUNCTION public.finanzas_numero_inmutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'Movement number is immutable' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finanzas_numero_inmutable ON public.finanzas_movimientos;
CREATE TRIGGER finanzas_numero_inmutable
BEFORE UPDATE OF numero ON public.finanzas_movimientos
FOR EACH ROW EXECUTE FUNCTION public.finanzas_numero_inmutable();

-- La lista paginada incluye el número (misma firma y mismo orden que 239).
CREATE OR REPLACE FUNCTION public.finanzas_movimientos_pagina(
  p_cuenta_id UUID, p_desde DATE, p_hasta DATE,
  p_tipo TEXT DEFAULT NULL, p_categoria TEXT DEFAULT NULL, p_moneda TEXT DEFAULT NULL,
  p_cartera TEXT DEFAULT NULL, p_anulados BOOLEAN DEFAULT false,
  p_limite INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0, p_version TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_version TEXT; total_rows BIGINT; rows_json JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 366
    OR p_limite NOT BETWEEN 1 AND 100 OR p_offset < 0 OR p_offset > 100000
    OR (p_tipo IS NOT NULL AND p_tipo NOT IN ('ingreso','egreso'))
    OR (p_moneda IS NOT NULL AND p_moneda NOT IN ('USD','VES','EUR','USDT'))
    OR (p_cartera IS NOT NULL AND p_cartera NOT IN ('USD','VES')) THEN
    RAISE EXCEPTION 'Filtros de lectura inválidos' USING ERRCODE='PT400';
  END IF;
  SELECT coalesce((SELECT version::text FROM public.finanzas_libro_version WHERE cuenta_id=p_cuenta_id),'0') INTO current_version;
  IF p_version IS NOT NULL AND p_version <> current_version THEN
    RAISE EXCEPTION 'El libro cambió. Actualiza la lista antes de continuar.' USING ERRCODE='PT409';
  END IF;
  SELECT count(*) INTO total_rows FROM public.finanzas_movimientos m
    WHERE m.cuenta_id=p_cuenta_id AND m.fecha BETWEEN p_desde AND p_hasta
      AND (p_tipo IS NULL OR m.tipo=p_tipo) AND (p_categoria IS NULL OR m.categoria=p_categoria)
      AND (p_moneda IS NULL OR m.moneda=p_moneda) AND (p_anulados OR m.estado='activo')
      AND (p_cartera IS NULL OR (p_cartera='VES' AND m.moneda='VES') OR (p_cartera='USD' AND m.moneda<>'VES'));
  SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.fecha DESC,row_data.creado_en DESC,row_data.id DESC),'[]'::jsonb)
    INTO rows_json FROM (
      SELECT m.id,m.numero,m.fecha,m.tipo,m.categoria,m.concepto,m.monto,m.moneda,m.tasa_ves,m.tasa_usd_ves,m.monto_ves,
        m.fuente_tasa,m.observacion_tasa,m.tasa_registrada_en,m.referencia,m.observaciones,m.metodo_pago,m.cuenta_origen,m.cuenta_custodia_id,
        m.partes,m.estado,m.creado_en,m.anulado_en,m.motivo_anulacion,m.operacion_id,
        CASE WHEN o.tipo IS NOT NULL THEN o.tipo ELSE NULL END AS origen_operacion
      FROM public.finanzas_movimientos m LEFT JOIN public.finanzas_operaciones o ON o.id=m.operacion_id AND o.cuenta_id=m.cuenta_id
      WHERE m.cuenta_id=p_cuenta_id AND m.fecha BETWEEN p_desde AND p_hasta
        AND (p_tipo IS NULL OR m.tipo=p_tipo) AND (p_categoria IS NULL OR m.categoria=p_categoria)
        AND (p_moneda IS NULL OR m.moneda=p_moneda) AND (p_anulados OR m.estado='activo')
        AND (p_cartera IS NULL OR (p_cartera='VES' AND m.moneda='VES') OR (p_cartera='USD' AND m.moneda<>'VES'))
      ORDER BY m.fecha DESC,m.creado_en DESC,m.id DESC LIMIT p_limite OFFSET p_offset
    ) row_data;
  RETURN jsonb_build_object('movimientos',rows_json,'versionLibro',current_version,'corte',statement_timestamp(),
    'paginacion',jsonb_build_object('total',total_rows,'limit',p_limite,'offset',p_offset,'recibidos',jsonb_array_length(rows_json),
      'siguiente',CASE WHEN p_offset+jsonb_array_length(rows_json)<total_rows THEN p_offset+jsonb_array_length(rows_json) ELSE NULL END));
END;
$$;
REVOKE ALL ON FUNCTION public.finanzas_movimientos_pagina(UUID,DATE,DATE,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_movimientos_pagina(UUID,DATE,DATE,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,INTEGER,TEXT) TO service_role;
COMMIT;
