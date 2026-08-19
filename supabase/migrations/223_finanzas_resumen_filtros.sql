-- 223_finanzas_resumen_filtros.sql
-- Actualiza el agregado financiero para que sus filtros coincidan con el listado.
-- El DROP solo elimina la firma anterior; nunca toca movimientos ni categorías.

DROP FUNCTION IF EXISTS public.finanzas_resumen(UUID, DATE, DATE, TEXT);

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
