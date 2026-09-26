-- supabase/migrations/247_nomina_horarios_unico.sql
-- Un solo horario permanente por persona y día de la semana.
--
-- `nomina_horarios` (migración 215) nació solo con índices, sin restricción de
-- unicidad. Sin ella, un guardado que fallaba a mitad dejaba filas repetidas para
-- el mismo día y la semana de la persona se ensanchaba en silencio (F-7 del plan
-- de flujo de nómina): la asistencia pasaba a mirar un horario duplicado sin que
-- nadie lo hubiera pedido.
--
-- El índice es PARCIAL: solo cubre el horario permanente (semana_ciclo y
-- fecha_hasta nulos), que es el que escribe la ficha del empleado. Los horarios
-- rotativos (`semana_ciclo`) y los de vigencia acotada (`fecha_hasta`) siguen
-- pudiendo convivir entre sí.
--
-- Antes del índice se limpia lo ya duplicado: se conserva la fila más reciente de
-- cada (empleado, día) y se descartan las anteriores. Es la fila que la ficha
-- habría dejado vigente.

WITH duplicados AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY empleado_id, dia_semana
           ORDER BY creado_en DESC NULLS LAST, id
         ) AS rn
  FROM public.nomina_horarios
  WHERE empleado_id IS NOT NULL
    AND semana_ciclo IS NULL
    AND fecha_hasta IS NULL
)
DELETE FROM public.nomina_horarios h
USING duplicados d
WHERE h.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS nomina_horarios_dia_permanente_unico
  ON public.nomina_horarios(empleado_id, dia_semana)
  WHERE empleado_id IS NOT NULL
    AND semana_ciclo IS NULL
    AND fecha_hasta IS NULL;

COMMENT ON INDEX public.nomina_horarios_dia_permanente_unico IS
  'Un horario permanente por empleado y día: la semana laboral de la ficha se actualiza fila por fila, nunca duplicando días.';
