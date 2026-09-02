# Auditoría de aislamiento — Nómina y Finanzas vs. POS Cotizaciones

**Fecha:** 29 de agosto de 2026

## Resultado

Los sistemas son independientes y no deben compartir ejecución, despliegue ni proyecto Supabase.

| Elemento | Nómina y Finanzas | POS Cotizaciones | Resultado |
|---|---|---|---|
| Repositorio local | `nomina-construacero` | `listo-pos-cotizaciones` | Separados |
| Proyecto Supabase | `wlxcclidnwketrghqaxs` | `oyfyuszgjwcepjpngclv` | Separados |
| Worker local | `8788` | `8787` | Sin choque |
| Worker producción | `nomina-construacero` | `listo-pos-cotizaciones` | Separados |
| Frontend/API | same-origin `/api/*` al Worker propio | reescritura al Worker del POS | Separados |
| Paquetes | `nomina-construacero` | `construacero-carabobo` | Separados |

## Evidencia revisada

- El `.env` y `wrangler.toml` de Nómina apuntan a `wlxcclidnwketrghqaxs.supabase.co`.
- El `.env` y `wrangler.toml` del POS apuntan a `oyfyuszgjwcepjpngclv.supabase.co`.
- Nómina usa `localhost:8788`; el POS usa `127.0.0.1:8787`.
- Las configuraciones Vite tienen proxies dirigidos al Worker correspondiente.
- Los dos repositorios tienen actualmente el mismo remoto Git reportado por el checkout local. Esto no produce un choque en tiempo de ejecución, pero sí es un riesgo de publicación: deben tener remotos/repositorios separados antes de hacer push.
- No se modificó el repositorio del POS.

## Condición importante: aislamiento de almacenamiento del navegador

Aunque las bases son diferentes, Supabase puede generar claves de sesión en `localStorage` basadas en el proyecto. Para evitar cualquier posibilidad de colisión entre versiones, dominios o configuraciones compartidas, cada aplicación debe ejecutarse en su propio dominio/subdominio de producción. No se recomienda servir ambas aplicaciones bajo el mismo origen con el mismo nombre de almacenamiento.

El POS conserva su propio service worker y su propio cache. Nómina conserva `public/sw.js` y usa el buster `nomina-construacero-*`. No deben copiarse assets de un proyecto al otro.

## Reglas operativas

1. No copiar `.env`, `.dev.vars`, service keys ni migraciones entre repositorios.
2. No ejecutar migraciones de Nómina contra `oyfyuszgjwcepjpngclv`.
3. No ejecutar migraciones del POS contra `wlxcclidnwketrghqaxs`.
4. Mantener puertos locales distintos: POS `8787`, Nómina `8788`.
5. Mantener dominios de producción distintos.
6. Configurar secretos de cada Worker únicamente en su propio proyecto de despliegue.
7. Corregir el remoto Git de este repositorio antes de publicar si realmente debe apuntar a un repositorio distinto del POS.

## Verificaciones realizadas

- Lint de Nómina: aprobado.
- Tests de Nómina: 374 aprobados.
- Build de Nómina: aprobado.
- Guardrail de proyecto: sigue bloqueado únicamente por `src/components/nomina/HolidayManager.jsx` (>600 líneas), no por un cruce con POS.

## Conclusión

No existe choque de Supabase, puerto, proxy, Worker o paquete entre los dos sistemas. La única alerta encontrada es de gobernanza Git: ambos checkouts declaran el mismo remoto `https://github.com/luiggiberaldi/listo-pos-cotizaciones.git`. No se cambia automáticamente porque hacerlo requeriría conocer el repositorio destino correcto y podría afectar publicación futura.
