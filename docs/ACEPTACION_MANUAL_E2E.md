# Aceptación manual E2E — Nómina y Finanzas

**Fecha:** 24 de agosto de 2026  
**Objetivo:** confirmar con personas reales que las tareas principales se completan sin explicación y sin errores de dinero.

## Cómo probar

- Usar una cuenta de prueba y datos que no sean de producción.
- No explicar los pasos antes de iniciar; solo leer la tarea.
- Registrar tiempo, dudas, errores y si la persona pide ayuda.
- Repetir en móvil de 360/390 px, escritorio de 1366 px, teclado y zoom 200 %.

## Tareas de aceptación

| # | Tarea para la persona | Debe poder lograr | Resultado | Observaciones |
|---|---|---|---|---|
| 1 | Entra al sistema con el correo y la contraseña de la cuenta. | Entra directamente en un solo paso y entiende qué hacer. | ☐ | |
| 2 | Busca a una persona y agrégala a nómina. | Configura salario y jornada sin confundir Personal con Nómina. | ☐ | |
| 3 | Registra la entrada y salida de una persona. | Encuentra el marcaje y entiende cuándo queda guardado. | ☐ | |
| 4 | Corrige una asistencia de la semana. | Abre una celda, cambia datos y confirma el resultado. | ☐ | |
| 5 | Prepara una nómina completa. | Crea período, calcula, revisa y cierra sin ayuda. | ☐ | |
| 6 | Registra el pago de los recibos. | Entiende el total, confirma y ve el período pagado. | ☐ | |
| 7 | Registra un gasto y revisa el balance. | Completa el formulario y encuentra el gasto en el listado. | ☐ | |
| 8 | Corrige un gasto duplicado. | Anula sin borrarlo y entiende qué cambia en el balance. | ☐ | |

## Criterios de liberación

- Cada tarea se completa sin instrucciones adicionales.
- Ninguna tarea contable termina con un monto incorrecto.
- Los botones y mensajes se entienden en lectura normal, sin depender de iconos.
- El teclado permite llegar a todos los controles y muestra foco visible.
- En móvil no se pierde información ni se pulsa una acción por accidente.
- Si falla la conexión, el mensaje indica qué hacer y no promete un guardado que no ocurrió.
- La operación compartida no se habilita: la cuenta está diseñada para un único usuario administrativo.

## Validación técnica ya cubierta

- Guardrails del proyecto, lint, pruebas automatizadas y build.
- Protección de sesión, rol, cuenta, idempotencia y auditoría en el Worker.
- Flujo de creación, consulta, resumen y anulación de Finanzas.
- Flujo de asistencia, cálculo, cierre, pago y reversión de Nómina.

La aceptación manual debe completarse con usuarios y datos de negocio antes de publicar o activar la operación real.
