-- supabase/migrations/242_roles_operativos_nomina_finanzas.sql
-- Roles operativos del lanzamiento por fases:
--   jefe     → acceso total (nómina + finanzas + gestión de usuarios)
--   finanzas → solo módulo Finanzas; registra ingresos/egresos y traspasos,
--              pero NUNCA ve saldos ni acumulados de las cuentas.
--   nomina   → solo módulo Nómina (empleados, asistencia, períodos); no ve finanzas.
--
-- 'administracion' y 'desarrollador' conservan su acceso total histórico
-- (compatibilidad: no se tocan usuarios existentes). La autorización fina
-- (qué puede hacer cada rol) vive en server/lib/permissions.js.
--
-- Reemplaza el guardia de rol único de la migración 222:
--   * constraint usuarios_rol_administracion_check (rol = 'administracion')
--   * trigger nomina_single_role_guard (rechaza INSERT/UPDATE con otro rol)
-- El CHECK ampliado reemplaza la protección del trigger: cualquier rol fuera
-- de la lista sigue siendo imposible de insertar a nivel de base.

BEGIN;

-- 1. Guardia de rol único (222) fuera: el CHECK ampliado la sustituye.
DROP TRIGGER IF EXISTS nomina_single_role_guard ON public.usuarios;
DROP FUNCTION IF EXISTS public.nomina_only_administration_role();

-- 2. Constraint: del rol único a la lista completa de roles operativos.
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_administracion_check;
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_rol_check CHECK (rol IN (
    'supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion',
    'logistica', 'desarrollador', 'jefe', 'finanzas', 'nomina'
  ));

COMMENT ON CONSTRAINT usuarios_rol_check ON public.usuarios IS 'Roles operativos: jefe=total, finanzas=solo Finanzas sin saldos, nomina=solo Nomina. La matriz de capacidades por rol vive en server/lib/permissions.js.';

COMMIT;
