-- 228_cuentas_custodia.sql
-- Cuentas bancarias, billeteras y cajas de custodia persistidas en Supabase
-- para compartirse entre dispositivos (antes vivían solo en localStorage).
-- La asignación de movimientos a estas cuentas se hace por cuenta_origen
-- explícita (migración 226); esta tabla es el catálogo de cuentas del tenant.

CREATE TABLE IF NOT EXISTS public.cuentas_custodia (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  codigo         TEXT,                                -- slug semilla (ej. 'banco-bnc-ves'); NULL en cuentas creadas
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) BETWEEN 1 AND 80),
  tipo           TEXT NOT NULL CHECK (tipo IN ('banco_ves','efectivo_ves','efectivo_usd','zelle','cripto_usdt')),
  cartera        TEXT NOT NULL CHECK (cartera IN ('VES','USD')),
  moneda         TEXT NOT NULL CHECK (moneda IN ('VES','USD','USDT')),
  banco          TEXT,
  numero_cuenta  TEXT,
  titular        TEXT,
  identificacion TEXT,
  subcuenta_id   TEXT NOT NULL,
  predeterminada BOOLEAN NOT NULL DEFAULT false,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evita duplicar el mismo nombre activo dentro de un tenant (el borrado es soft
-- vía activo=false, así no bloquea volver a crear con ese nombre).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuentas_custodia_cuenta_nombre_activa
  ON public.cuentas_custodia(cuenta_id, lower(nombre)) WHERE activo;

CREATE INDEX IF NOT EXISTS idx_cuentas_custodia_cuenta_activo
  ON public.cuentas_custodia(cuenta_id, activo, predeterminada, creado_en);

ALTER TABLE public.cuentas_custodia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cuentas_custodia_tenant_restrictive ON public.cuentas_custodia;
CREATE POLICY cuentas_custodia_tenant_restrictive ON public.cuentas_custodia
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

DROP POLICY IF EXISTS cuentas_custodia_admin_all ON public.cuentas_custodia;
CREATE POLICY cuentas_custodia_admin_all ON public.cuentas_custodia
  FOR ALL TO authenticated
  USING (get_rol_actual() = 'administracion')
  WITH CHECK (get_rol_actual() = 'administracion');

COMMENT ON TABLE public.cuentas_custodia IS
  'Catálogo de cuentas de custodia por tenant. El borrado es lógico (activo=false);'
  ' los movimientos nunca se eliminan y se asignan por cuenta_origen.';
