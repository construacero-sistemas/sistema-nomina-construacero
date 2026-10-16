-- Compatibilidad de pgcrypto entre motores. En proyectos Supabase nuevos
-- (PostgreSQL 17) la extensión se preinstala en el schema "extensions", pero
-- las funciones del proyecto declaran search_path=pg_catalog,public y llaman
-- digest() sin calificar (238, 241, 244, 253): la llamada no resuelve y falla
-- con SQLSTATE 42883. Donde digest() no exista en public, un envoltorio público
-- delega en extensions.digest para que el mismo código funcione en PGlite/local
-- (pgcrypto en public) y en Supabase. Si digest() ya está en public, no se hace
-- nada: el envoltorio duplicaría la firma de la extensión.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.digest(bytea,text)') IS NULL
    AND to_regprocedure('extensions.digest(bytea,text)') IS NOT NULL THEN
    EXECUTE 'CREATE FUNCTION public.digest(p_data bytea, p_algoritmo text) RETURNS bytea LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $fn$ SELECT extensions.digest(p_data, p_algoritmo) $fn$';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO PUBLIC';
  END IF;
  IF to_regprocedure('public.digest(text,text)') IS NULL
    AND to_regprocedure('extensions.digest(text,text)') IS NOT NULL THEN
    EXECUTE 'CREATE FUNCTION public.digest(p_data text, p_algoritmo text) RETURNS bytea LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $fn$ SELECT extensions.digest(p_data, p_algoritmo) $fn$';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.digest(text, text) TO PUBLIC';
  END IF;
END $$;

COMMIT;
