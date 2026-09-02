# QA — Gesto de arrastre en bottom sheets (iPhone real)

**Fecha:** 01/09/2026 · **Autor:** Buffy · **Alcance:** validación manual en dispositivo táctil.

## Contexto

La app usa `compat/components/ui/Modal.jsx` como **hoja inferior (bottom sheet)** en móvil, con un **tirador (grabber)** y un **gesto de arrastre para cerrar**. La vista previa de escritorio no puede simular touch real, así que esto **solo se puede validar en un iPhone físico**.

## Objetivo

Confirmar que al arrastrar hacia abajo el bottom sheet se cierra (o vuelve a su sitio), sin interferir con el scroll interno ni generar rebotes raros.

## Pasos

1. Abrir la app en un iPhone (Safari o el PWA) a ancho móvil.
2. Ir a **Nómina > Empleados** y pulsar **Nuevo Empleado** → abrir `EmpleadoConfigModal`.
3. Confirmar que arriba se ve **el tirador** (barra horizontal redondeada de ~40 px).
4. **Prueba A — cerrar:** con el dedo sobre el tirador, arrastrar hacia abajo **> 120 px** y soltar. **Esperado:** el modal se cierra.
5. **Prueba B — volver:** arrastrar hacia abajo **poco (< 120 px)** y soltar. **Esperado:** la hoja **vuelve a su posición** con una transición suave.
6. **Prueba C — no interferir con el scroll:** dentro del modal (ej. en `MovimientoForm`, con el formulario largo), hacer scroll vertical normal con el dedo. **Esperado:** el scroll interno funciona y **no** cierra el modal. Nota: el gesto de arrastre está **solo en el tirador**, no en el cuerpo.
7. Repetir en otros modales: `MovimientoForm` (Finanzas), `ComisionPagoModal` (Empleados > vendedor > Pagar Comisión), `PeriodoDetalleModal` (Períodos > Ver Recibos), `SyncPosModal`.

## Qué revisar (checklist)

- [ ] El tirador es visible y tiene área táctil amplia.
- [ ] Arrastre > 120 px cierra el modal.
- [ ] Arrastre < 120 px devuelve la hoja a su sitio (sin quedarse a medias).
- [ ] El scroll interno del contenido no cierra el modal por accidente.
- [ ] El fondo con desenfoque (`backdrop-blur`) se ve bien al arrastrar.
- [ ] En iPhone SE (375 px) y iPhone 15 (393 px): sin desborde horizontal al cerrarse la hoja.
- [ ] Accesibilidad: el botón **X / Cerrar** del encabezado sigue funcionando.
- [ ] El **foco** vuelve al elemento anterior al cerrar (trampa de foco del modal).

## Criterio de aceptación

- El gesto de arrastre cierra/recupera la hoja de forma fluida, sin `jank` perceptible ni saltos.
- No hay regresión en el scroll interno ni en los modales de escritorio (≥ 640 px, donde el grabber está oculto y el modal se centra).

## Observaciones

- Si el arrastre **no** responde, revisar que el evento `touchmove` no esté bloqueado por un `preventDefault` en el contenedor.
- Si el modal se cierra al hacer scroll normal, es que el gesto se está activando desde el cuerpo; verificar que `onTouchStart`/`onTouchMove`/`onTouchEnd` estén solo en el contenedor del tirador.
