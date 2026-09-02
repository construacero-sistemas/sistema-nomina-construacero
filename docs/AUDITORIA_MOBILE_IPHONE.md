# Auditoría mobile-first — Nómina y Finanzas

**Fecha:** 29 de agosto de 2026

## Objetivo

El sistema se usará principalmente en móviles, especialmente iPhone. La experiencia debe funcionar desde 360 px de ancho, con safe areas, teclado virtual, navegación táctil y orientación vertical como prioridad.

## Ajustes aplicados

- Viewport con `viewport-fit=cover` e `interactive-widget=resizes-content`.
- Compatibilidad con barra de estado y safe areas de iOS.
- Prevención del zoom automático de Safari en campos (`font-size: 16px`).
- Eliminación del highlight azul predeterminado al tocar controles.
- `touch-action: manipulation` en botones, enlaces y controles táctiles.
- Navegación inferior con espacio para el home indicator de iPhone.
- Contenido principal con padding inferior suficiente para no quedar oculto por la navegación fija.
- Shell con `100dvh` y fallback `-webkit-fill-available`.
- Login adaptado a alturas pequeñas y notch.
- Manifest con `scope` para instalación PWA coherente.
- Las tablas y pestañas conservan desplazamiento horizontal controlado donde el contenido lo requiere.

## Puntos revisados

| Área | Estado |
|---|---|
| Login y teclado Safari | Ajustado |
| Notch/home indicator | Ajustado |
| Navegación móvil | Existente y ajustada |
| Drawer lateral | Existente, táctil |
| Formularios | Deben probarse con teclado abierto |
| Modales | Usan scroll interno; validar altura real en iPhone |
| Tablas financieras | Requieren desplazamiento horizontal indicado |
| PDFs | Requieren prueba de descarga/visualización en iOS |
| Orientación vertical | Prioridad |
| Desktop | Conservado como experiencia secundaria |

## Matriz manual obligatoria

- iPhone SE: 375 × 667.
- iPhone 12/13: 390 × 844.
- iPhone 14/15 Pro Max: 430 × 932.
- Safari iOS con teclado abierto.
- Safari iOS en modo standalone/PWA.
- Zoom del sistema aumentado.
- Orientación vertical y rotación a horizontal.
- Conexión intermitente.

## Criterios de aceptación

- Ningún control crítico queda debajo del home indicator.
- Abrir el teclado no oculta el botón Guardar/Acceder.
- No aparece zoom inesperado al enfocar inputs.
- No existe scroll horizontal de toda la página.
- Las tablas se desplazan dentro de su contenedor.
- Los modales se pueden cerrar y desplazar con una mano.
- Los botones táctiles tienen al menos aproximadamente 44 px de área útil.
- La navegación inferior no cubre contenido.
- Las cifras financieras permanecen completas y legibles.
- No se confirma una operación financiera por un toque accidental.

## Pendientes de validación física

La auditoría de código no sustituye probar Safari en un iPhone real. Antes de producción se debe completar el recorrido de acceso, asistencia, nómina y Finanzas en los dispositivos indicados, especialmente con teclado abierto y modo PWA.
