# PLAN_HOJA_SEMANAL

Objetivo: que la persona que lleva la nómina y la contadora vean y llenen en la app
**la misma hoja que hoy hacen en Excel** (lapso jueves → miércoles), con los totales
bien sumados, sin la tabla aparte «Nómina del personal sueldo legal»: el bono de $35
va en el primer recuadro.

## Decisiones (usuario, 17/11/2026)

| # | Decisión |
|---|---|
| D-1 | Semana = mensual ÷ 30 × 7 (audio del dueño, 16/11: 5 laborables + 2 de descanso; «por exclusión»: una falta injustificada descuenta su día) |
| D-2 | **Bono semanal = $35 fijo**, en una columna del primer recuadro. **Sueldo semanal = semana − bono** (es lo que varía por persona) |
| D-3 | **Decidido (18/11/2026): el sueldo semanal se llena primero**, hasta su tope (semana completa − $35); el bono es lo que sobra, hasta $35. Una falta o una semana a medias baja el **bono**, no el sueldo. El total no cambia |
| D-4 | Todos cobran el bono; interruptor por ficha «Cobra bono semanal» para excluir a alguien (Fase 2) |
| D-5 | Los pagos fuera de nómina (Gerson Salazar, José Luis González, Armansio Martínez…) no van en la hoja |
| D-6 | Josué Marciales no se incluye por ahora |
| D-7 | Hora extra = $2,50 fijos por hora; sábado, domingo o feriado trabajado = un día adicional (mensual ÷ 30) |
| D-8 | El **descuento manual** se agrega desde la propia hoja |

## Columnas (igual que la planilla)

| Columna | De dónde sale |
|---|---|
| Nombre | Ficha |
| Sueldo mensual | Sueldo diario congelado en el recibo × divisor (30) |
| Días trab. | Días laborables trabajados (sin contar descansos ni feriados trabajados) |
| Sueldo semanal | Lo que se lleva primero de la semana, hasta (sueldo mensual ÷ 30 × 7) − $35 |
| Bono semanal | El resto de la semana, hasta $35 |
| Horas extra / Total extras | Horas extra del recibo / su monto |
| Desc./feriado trab. / Valor | Días de descanso o feriado trabajados / lo que pagan (día adicional + recargos o montos fijos) |
| Otros pagos | Bonos manuales del recibo |
| Total a cobrar | Bruto del recibo |
| Descuentos | Descuentos del recibo, con botón para agregar uno |
| Neto $ / Neto Bs | Neto del recibo; en Bs, con la tasa activa (o la congelada al pagar o cerrar) |

**Invariante (guardarraíl):** sueldo semanal + bono + total extras + valor + otros pagos =
total a cobrar del recibo, en cada fila. La hoja **no recalcula** la nómina: reparte en
columnas lo que el motor ya calculó. Si el motor cambia, la hoja lo refleja sola.

## Fases

| Fase | Contenido |
|---|---|
| 1 | `server/lib/nominaHoja.js` (función pura) + `GET /api/nomina/periodos/hoja` (solo lectura) + pestaña «Hoja semanal» en el detalle del período: columnas, totales sumando **todas** las filas, botón «+ Descuento» (abre el ajuste existente) y descarga a Excel (.csv) |
| 2 | Interruptor «Cobra bono semanal» por ficha (D-4) y monto del bono editable en Configuración |
| 3 | Período automático jueves → miércoles y recálculo en vivo con el marcaje: la hoja «se va llenando» durante la semana |

## Arneses y guardarraíles

- `server/lib/__tests__/nominaHoja.test.js`: matriz de casos (semana completa, falta, descanso trabajado, feriado, monto fijo, sin bono) que comprueba la **invariante** en cada fila y los totales.
- Handler: permiso `verNomina`, filtro de tenant, `periodoId` válido, sin escrituras (G-6, G-7 del plan de marcaje).
- UI: columnas y totales; el botón de descuento solo aparece con período abierto y permiso de gestión; la descarga contiene la fila de totales.
- `check:project` (600 líneas), `test:responsive` (tabla con desplazamiento horizontal en móvil) y `npm run verify` al cerrar cada fase.

## Estado

### Fase 1 (rama `nomina/hoja-semanal`, 17/11/2026): implementada

- `server/lib/nominaHoja.js`: función pura con 8 pruebas que generan los recibos con el motor real. Guardarraíl: la invariante de cada fila y los totales de todas las filas.
- `GET /api/nomina/periodos/hoja` (`nomina.hoja.js`): solo lectura, `verNomina`, filtro de tenant. Tolera la falta de la migración 262, como el listado de recibos. 5 pruebas, más el arnés de `worker.e2e`.
- **Smoke de staging:** la hoja del período sintético cuadra con su recibo (`weeklySheetAddsUp`). Este smoke fue el que encontró la falta de tolerancia a la migración 262.
- **Pantalla:** pestaña «Hoja semanal» en el detalle del período.
  - **Responsiva sin recortar:** en teléfono y tablet, una ficha por persona con todos los campos, más la ficha de totales; desde 1024 px, la tabla completa dentro del modal, sin desplazamiento lateral.
  - Medido en una demo con las 11 personas de la planilla, a 320, 375, 800 y 1280 px: 0 elementos fuera de pantalla, 0 celdas cortadas y botones de al menos 44 px.
- **Descuento manual (D-8):** «Agregar descuento» en cada ficha y «+» en cada fila de la tabla. Abren el mismo ajuste del recibo, solo con período abierto, permiso de gestión y recibo sin pagar.
- **Descargar Excel:** CSV con «;», coma decimal y fila de totales.

Pendiente: Fase 2 (D-4: interruptor «Cobra bono semanal» por ficha) y Fase 3 (período automático jueves → miércoles y llenado en vivo). D-3 decidida el 18/11/2026: sueldo primero.
