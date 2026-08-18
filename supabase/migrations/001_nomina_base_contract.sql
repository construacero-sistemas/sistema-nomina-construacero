-- 001_nomina_base_contract.sql
-- Contrato mínimo del repositorio independiente de Nómina Construacero.
--
-- Este archivo NO migra Personal ni las tablas del POS. La identidad de cada
-- cuenta es un usuario de auth.users; Personal puede sincronizar empleados a
-- public.clientes usando id_externo/documento sin transferir su módulo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.usuarios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre                TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rol                   TEXT NOT NULL CHECK (rol IN (
    'supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion',
    'logistica', 'desarrollador', 'jefe'
  )),
  activo                BOOLEAN NOT NULL DEFAULT true,
  pin_hash              TEXT,
  pin_salt              TEXT,
  color                 TEXT,
  telefono              TEXT,
  markup_pct            NUMERIC(8,4),
  comision_pct          NUMERIC(8,4),
  comision_pct_cabilla  NUMERIC(8,4),
  es_externo            BOOLEAN NOT NULL DEFAULT false,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nomina_usuarios_cuenta_activo
  ON public.usuarios(cuenta_id, activo, nombre);

CREATE TABLE IF NOT EXISTS public.clientes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id_externo     TEXT,
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  documento      TEXT,
  rif            TEXT,
  telefono       TEXT,
  tipo_cliente   TEXT NOT NULL DEFAULT 'personal',
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cuenta_id, id_externo)
);

CREATE INDEX IF NOT EXISTS idx_nomina_clientes_cuenta_personal
  ON public.clientes(cuenta_id, tipo_cliente, activo);

CREATE TABLE IF NOT EXISTS public.configuracion_negocio (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id                     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_negocio                TEXT NOT NULL DEFAULT 'Construacero Nómina',
  rif_negocio                   TEXT,
  logo_url                      TEXT,
  telefono_negocio              TEXT,
  email_negocio                 TEXT,
  nomina_factor_hora_extra      NUMERIC(4,2) NOT NULL DEFAULT 1.50 CHECK (nomina_factor_hora_extra >= 1),
  nomina_factor_sabado          NUMERIC(4,2) NOT NULL DEFAULT 1.25 CHECK (nomina_factor_sabado >= 1),
  nomina_factor_feriado         NUMERIC(4,2) NOT NULL DEFAULT 2.00 CHECK (nomina_factor_feriado >= 1),
  nomina_tipo_periodo           TEXT NOT NULL DEFAULT 'semanal' CHECK (nomina_tipo_periodo IN ('semanal','quincenal','mensual')),
  nomina_horas_extra_max_semana NUMERIC(5,2) NOT NULL DEFAULT 10.00 CHECK (nomina_horas_extra_max_semana >= 0),
  nomina_v2_enabled              BOOLEAN NOT NULL DEFAULT false,
  creado_en                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditoria (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  cuenta_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  usuario_id     UUID,
  usuario_nombre TEXT,
  usuario_rol    TEXT,
  categoria      TEXT NOT NULL,
  accion         TEXT NOT NULL,
  descripcion    TEXT,
  entidad_tipo   TEXT,
  entidad_id     UUID,
  meta           JSONB,
  ip_origen      INET
);

CREATE INDEX IF NOT EXISTS idx_nomina_auditoria_cuenta_ts
  ON public.auditoria(cuenta_id, ts DESC);

-- El JWT conserva el operador elegido en app_metadata. La cuenta sigue siendo
-- auth.uid(), por lo que cambiar de operador nunca cambia de tenant.
CREATE OR REPLACE FUNCTION public.get_operador_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.jwt()->'app_metadata'->>'operator_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (auth.jwt()->'app_metadata'->>'operator_id')::uuid
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- El desarrollador virtual es una excepción explícita y sigue requiriendo
    -- la metadata que solo puede escribir el Worker con acceso administrativo.
    WHEN public.get_operador_id() = '00000000-0000-0000-0000-000000000000'::uuid
      AND auth.jwt()->'app_metadata'->>'operator_rol' = 'desarrollador'
      THEN 'desarrollador'
    ELSE (
      SELECT u.rol FROM public.usuarios u
      WHERE u.id = public.get_operador_id()
        AND u.cuenta_id = auth.uid()
        AND u.activo = true
    )
  END;
$$;

-- La lista de inicio de sesión nunca devuelve PIN, salt ni otras credenciales.
CREATE OR REPLACE FUNCTION public.listar_usuarios_login()
RETURNS TABLE(
  id UUID,
  nombre TEXT,
  rol TEXT,
  color TEXT,
  imagen_url TEXT,
  markup_pct NUMERIC,
  es_externo BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::TEXT, u.markup_pct, u.es_externo
  FROM public.usuarios u
  WHERE u.cuenta_id = auth.uid()
    AND u.activo = true
  ORDER BY u.nombre;
$$;

REVOKE ALL ON FUNCTION public.listar_usuarios_login() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO authenticated;

-- No se concede lectura directa de usuarios porque pin_hash/pin_salt son
-- secretos del Worker. La selección de operador usa únicamente el RPC seguro.
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomina_usuarios_deny_direct_select ON public.usuarios;
CREATE POLICY nomina_usuarios_deny_direct_select ON public.usuarios
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomina_clientes_tenant_select ON public.clientes;
CREATE POLICY nomina_clientes_tenant_select ON public.clientes
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());
-- No se habilita escritura directa desde el navegador: Personal → Nómina es
-- una sincronización server-to-server y el Worker no muta fichas de Personal.

ALTER TABLE public.configuracion_negocio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomina_configuracion_tenant ON public.configuracion_negocio;
CREATE POLICY nomina_configuracion_tenant ON public.configuracion_negocio
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nomina_auditoria_tenant_select ON public.auditoria;
CREATE POLICY nomina_auditoria_tenant_select ON public.auditoria
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

COMMENT ON TABLE public.usuarios IS 'Operadores de Nómina; los PIN se consultan y validan únicamente en el Worker.';
COMMENT ON TABLE public.clientes IS 'Contrato mínimo de empleados sincronizados; no reemplaza el módulo Personal del POS.';
COMMENT ON COLUMN public.clientes.id_externo IS 'Identidad del empleado en el sistema origen, si existe sincronización.';
COMMENT ON TABLE public.configuracion_negocio IS 'Configuración por cuenta y factores de nómina.';
