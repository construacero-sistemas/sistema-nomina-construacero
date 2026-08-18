-- 220_nomina_integrity_guardrails.sql
-- Guardrails de último nivel para el proyecto Supabase independiente.
-- El Worker sigue filtrando cuenta_id explícitamente; estos triggers evitan que
-- una mutación de service_role pueda vincular accidentalmente datos de cuentas
-- distintas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_feriados_cuenta_fk'
      AND conrelid = 'public.nomina_feriados'::regclass
  ) THEN
    ALTER TABLE public.nomina_feriados
      ADD CONSTRAINT nomina_feriados_cuenta_fk
      FOREIGN KEY (cuenta_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_horarios_cuenta_fk'
      AND conrelid = 'public.nomina_horarios'::regclass
  ) THEN
    ALTER TABLE public.nomina_horarios
      ADD CONSTRAINT nomina_horarios_cuenta_fk
      FOREIGN KEY (cuenta_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_config_horas_jornada_limit'
      AND conrelid = 'public.nomina_config_empleado'::regclass
  ) THEN
    ALTER TABLE public.nomina_config_empleado
      ADD CONSTRAINT nomina_config_horas_jornada_limit CHECK (horas_jornada <= 24);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_asistencia_horas_normales_nonnegative'
      AND conrelid = 'public.registro_asistencia'::regclass
  ) THEN
    ALTER TABLE public.registro_asistencia
      ADD CONSTRAINT nomina_asistencia_horas_normales_nonnegative CHECK (horas_normales >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_asistencia_horas_extra_nonnegative'
      AND conrelid = 'public.registro_asistencia'::regclass
  ) THEN
    ALTER TABLE public.registro_asistencia
      ADD CONSTRAINT nomina_asistencia_horas_extra_nonnegative CHECK (horas_extra >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_linea_bonos_nonnegative'
      AND conrelid = 'public.nomina_lineas'::regclass
  ) THEN
    ALTER TABLE public.nomina_lineas
      ADD CONSTRAINT nomina_linea_bonos_nonnegative CHECK (bonos_usd >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_linea_deducciones_nonnegative'
      AND conrelid = 'public.nomina_lineas'::regclass
  ) THEN
    ALTER TABLE public.nomina_lineas
      ADD CONSTRAINT nomina_linea_deducciones_nonnegative CHECK (deducciones_usd >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nomina_linea_totales_nonnegative'
      AND conrelid = 'public.nomina_lineas'::regclass
  ) THEN
    ALTER TABLE public.nomina_lineas
      ADD CONSTRAINT nomina_linea_totales_nonnegative
      CHECK (total_bruto_usd >= 0 AND total_neto_usd >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.nomina_check_config_empleado_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE empleado_cuenta UUID;
BEGIN
  SELECT c.cuenta_id INTO empleado_cuenta
  FROM public.clientes c
  WHERE c.id = NEW.empleado_id;

  IF empleado_cuenta IS NULL OR empleado_cuenta IS DISTINCT FROM NEW.cuenta_id THEN
    RAISE EXCEPTION 'El empleado y la configuración no pertenecen a la misma cuenta'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nomina_check_asistencia_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE empleado_cuenta UUID;
BEGIN
  SELECT c.cuenta_id INTO empleado_cuenta
  FROM public.clientes c
  WHERE c.id = NEW.empleado_id;

  IF empleado_cuenta IS NULL OR empleado_cuenta IS DISTINCT FROM NEW.cuenta_id THEN
    RAISE EXCEPTION 'La asistencia y el empleado no pertenecen a la misma cuenta'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nomina_check_horario_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE empleado_cuenta UUID;
BEGIN
  IF NEW.empleado_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.cuenta_id INTO empleado_cuenta
  FROM public.clientes c
  WHERE c.id = NEW.empleado_id;

  IF empleado_cuenta IS NULL OR empleado_cuenta IS DISTINCT FROM NEW.cuenta_id THEN
    RAISE EXCEPTION 'El horario y el empleado no pertenecen a la misma cuenta'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nomina_check_linea_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE periodo_cuenta UUID; empleado_cuenta UUID;
BEGIN
  SELECT p.cuenta_id INTO periodo_cuenta
  FROM public.nomina_periodos p
  WHERE p.id = NEW.periodo_id;

  SELECT c.cuenta_id INTO empleado_cuenta
  FROM public.clientes c
  WHERE c.id = NEW.empleado_id;

  IF periodo_cuenta IS NULL
     OR empleado_cuenta IS NULL
     OR periodo_cuenta IS DISTINCT FROM NEW.cuenta_id
     OR empleado_cuenta IS DISTINCT FROM NEW.cuenta_id THEN
    RAISE EXCEPTION 'La línea, el período y el empleado no pertenecen a la misma cuenta'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nomina_check_linea_concepto_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE linea_cuenta UUID; concepto_cuenta UUID;
BEGIN
  SELECT l.cuenta_id INTO linea_cuenta
  FROM public.nomina_lineas l
  WHERE l.id = NEW.linea_id;

  IF NEW.concepto_id IS NOT NULL THEN
    SELECT c.cuenta_id INTO concepto_cuenta
    FROM public.nomina_conceptos c
    WHERE c.id = NEW.concepto_id;
  END IF;

  IF linea_cuenta IS NULL
     OR linea_cuenta IS DISTINCT FROM NEW.cuenta_id
     OR (NEW.concepto_id IS NOT NULL AND concepto_cuenta IS DISTINCT FROM NEW.cuenta_id) THEN
    RAISE EXCEPTION 'El concepto, la línea y el tenant no coinciden'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nomina_check_tasa_periodo_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE periodo_cuenta UUID;
BEGIN
  IF NEW.periodo_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.cuenta_id INTO periodo_cuenta
  FROM public.nomina_periodos p
  WHERE p.id = NEW.periodo_id;

  IF periodo_cuenta IS NULL OR periodo_cuenta IS DISTINCT FROM NEW.cuenta_id THEN
    RAISE EXCEPTION 'La tasa y el período no pertenecen a la misma cuenta'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nomina_config_empleado_tenant_guard ON public.nomina_config_empleado;
CREATE TRIGGER nomina_config_empleado_tenant_guard
  BEFORE INSERT OR UPDATE ON public.nomina_config_empleado
  FOR EACH ROW EXECUTE FUNCTION public.nomina_check_config_empleado_tenant();

DROP TRIGGER IF EXISTS nomina_asistencia_tenant_guard ON public.registro_asistencia;
CREATE TRIGGER nomina_asistencia_tenant_guard
  BEFORE INSERT OR UPDATE ON public.registro_asistencia
  FOR EACH ROW EXECUTE FUNCTION public.nomina_check_asistencia_tenant();

DROP TRIGGER IF EXISTS nomina_horario_tenant_guard ON public.nomina_horarios;
CREATE TRIGGER nomina_horario_tenant_guard
  BEFORE INSERT OR UPDATE ON public.nomina_horarios
  FOR EACH ROW EXECUTE FUNCTION public.nomina_check_horario_tenant();

DROP TRIGGER IF EXISTS nomina_linea_tenant_guard ON public.nomina_lineas;
CREATE TRIGGER nomina_linea_tenant_guard
  BEFORE INSERT OR UPDATE ON public.nomina_lineas
  FOR EACH ROW EXECUTE FUNCTION public.nomina_check_linea_tenant();

DROP TRIGGER IF EXISTS nomina_linea_concepto_tenant_guard ON public.nomina_linea_conceptos;
CREATE TRIGGER nomina_linea_concepto_tenant_guard
  BEFORE INSERT OR UPDATE ON public.nomina_linea_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.nomina_check_linea_concepto_tenant();

DROP TRIGGER IF EXISTS nomina_tasa_periodo_tenant_guard ON public.nomina_tasas_snapshot;
CREATE TRIGGER nomina_tasa_periodo_tenant_guard
  BEFORE INSERT OR UPDATE ON public.nomina_tasas_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.nomina_check_tasa_periodo_tenant();

COMMENT ON FUNCTION public.nomina_check_linea_tenant() IS
  'Impide vincular una línea de nómina con un período o empleado de otra cuenta.';
