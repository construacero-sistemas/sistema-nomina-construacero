-- Aislamiento por cuenta para las tablas de nómina.
-- El Worker usa service key, por lo que además de RLS sus handlers deben
-- filtrar cuenta_id en cada consulta y mutación.

DO $$
DECLARE
  tabla TEXT;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'nomina_config_empleado', 'registro_asistencia',
    'nomina_periodos', 'nomina_lineas'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format(
      'DROP POLICY IF EXISTS nomina_tenant_restrictive_%I ON public.%I',
      tabla, tabla
    );
    EXECUTE format(
      'CREATE POLICY nomina_tenant_restrictive_%I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid())',
      tabla, tabla
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_nomina_lineas_cuenta_periodo
  ON public.nomina_lineas(cuenta_id, periodo_id);
CREATE INDEX IF NOT EXISTS idx_nomina_lineas_cuenta_empleado
  ON public.nomina_lineas(cuenta_id, empleado_id, creado_en DESC);
