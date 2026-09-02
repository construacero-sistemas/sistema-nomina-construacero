-- 230_cajas_permanentes.sql
-- Las cajas físicas de efectivo (Bs y $) son PERMANENTES: el dinero que no está
-- en un banco está en la caja, así que siempre deben existir como bucket de
-- custodia. Esta migración:
--   1. Reactiva (activo=true) las cajas semilla que el tenant haya eliminado.
--   2. Si el tenant nunca tuvo las semillas (no hay fila por codigo), las crea.
--   3. Instala un trigger que impide desactivarlas o borrarlas (borrado lógico
--      o físico) — defensa en profundidad junto al guard del backend.
-- La identificación es por `codigo` semilla ('caja-efectivo-bs'/'caja-efectivo-usd'),
-- que sobrevive renombres y ediciones. Las cajas EXTRA del usuario (sin codigo
-- semilla o con otro) NO están protegidas: se pueden borrar con normalidad.

-- 1) Reactivar semillas existentes (incluso si fueron eliminadas lógicamente).
UPDATE public.cuentas_custodia
SET activo = true, actualizado_en = now()
WHERE codigo IN ('caja-efectivo-bs', 'caja-efectivo-usd')
  AND activo = false;

-- 2) Crear las que falten (tenant nuevo o semilla nunca insertada), por tenant.
INSERT INTO public.cuentas_custodia (
  cuenta_id, codigo, nombre, tipo, cartera, moneda, banco,
  subcuenta_id, predeterminada, activo
)
SELECT
  u.id,
  s.codigo,
  s.nombre,
  s.tipo,
  s.cartera,
  s.moneda,
  s.banco,
  s.subcuenta_id,
  true,
  true
FROM auth.users u
CROSS JOIN (VALUES
  ('caja-efectivo-bs',  'Caja Efectivo Bs', 'efectivo_ves', 'VES', 'VES',  'Caja Física', 'Efectivo Bs'),
  ('caja-efectivo-usd', 'Caja Efectivo $',  'efectivo_usd', 'USD', 'USD',  'Caja Fuerte', 'Efectivo $')
) AS s(codigo, nombre, tipo, cartera, moneda, banco, subcuenta_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cuentas_custodia cc
  WHERE cc.cuenta_id = u.id AND cc.codigo = s.codigo
);

-- 3) Trigger anti-desactivación/borrado de las cajas permanentes.
CREATE OR REPLACE FUNCTION public.proteger_cajas_permanentes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Aplica solo a las semillas permanentes.
  IF NEW.codigo IN ('caja-efectivo-bs', 'caja-efectivo-usd') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Las cajas físicas permanentes no se pueden eliminar';
    END IF;
    -- En UPDATE/INSERT, forzar activo=true (la UI y el backend ya lo impiden;
    -- esto cubre accesos directos a la tabla, ej. desde el SQL editor).
    IF NEW.activo = false THEN
      RAISE EXCEPTION 'Las cajas físicas permanentes no se pueden desactivar';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_cajas_permanentes ON public.cuentas_custodia;
CREATE TRIGGER trg_proteger_cajas_permanentes
  BEFORE UPDATE OF activo OR DELETE ON public.cuentas_custodia
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_cajas_permanentes();

COMMENT ON FUNCTION public.proteger_cajas_permanentes() IS
  'Cajas físicas (Bs/$) permanentes: impide desactivarlas o borrarlas. Cajas extra del usuario no afectadas.';
