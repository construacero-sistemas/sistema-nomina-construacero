-- Un movimiento no puede llevar fecha futura: la fecha máxima es hoy (hora de Caracas).
-- Las fechas pasadas siguen permitidas (mientras su mes no esté cerrado). Solo se evalúa al
-- crear un movimiento o al cambiar su fecha: anular o corregir textos de uno ya existente
-- no se bloquea aunque su fecha sea posterior a hoy.
BEGIN;

CREATE OR REPLACE FUNCTION public.finanzas_fecha_no_futura() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'America/Caracas' AS $$
BEGIN
  IF NEW.fecha > (now() AT TIME ZONE 'America/Caracas')::date THEN
    RAISE EXCEPTION 'Movement date cannot be in the future' USING ERRCODE = 'PT400';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finanzas_fecha_no_futura ON public.finanzas_movimientos;
CREATE TRIGGER finanzas_fecha_no_futura
BEFORE INSERT OR UPDATE OF fecha ON public.finanzas_movimientos
FOR EACH ROW EXECUTE FUNCTION public.finanzas_fecha_no_futura();
COMMIT;
