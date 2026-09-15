-- 237_finanzas_rpc_service_only.sql
-- El resumen financiero es invocado exclusivamente por el backend autorizado.
-- Corrige el GRANT ampliado de 232/233 sin reescribir migraciones aplicadas.
-- Aplicar solo mediante el proceso de migración aprobado; no modifica datos.
BEGIN;

REVOKE ALL ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) IS
  'Resumen privado por tenant. Solo service_role tras validación de cuenta/rol en el backend; nunca invocar desde el navegador.';

COMMIT;
