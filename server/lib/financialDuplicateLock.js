// La protección contra carreras se aplica en finanzas_guard_duplicate_movement
// mediante pg_advisory_xact_lock dentro de la transacción de cada escritura.
