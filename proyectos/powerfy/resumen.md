# Powerfy ERP: resumen

## Qué es

ERP sobre Odoo 18 CE para PyMEs de Centroamérica (y RD): localización, migración desde otros ERP, IA por rol, POS y website propio. Org GitHub `bacgroup`, cuenta gh `nlopez-bacg`.

## Repos y entornos

- Padre: `powerfy-docker` (build, CI, deploy, ROADMAP, docs/AMBIENTES.md y OPERACION.md). Addons: `powerfy-addons`, `powerfy-ai`, `powerfy-bi`, `powerfy-l10n`.
- LOCAL: `C:\MiCarpeta\Odoo DEVs\PowerFy` (hasta el 2026-10-30, `C:\powerfy`), Odoo en http://localhost:8069 (base `powerfy`), Postgres en 5544.
- DEV: rama `18.0-dev` → dev.powerfy.cloud. PROD: rama `18.0` → prod.powerfy.cloud; DEMO y WEB usan la misma imagen.

## Reglas que no se negocian

- Rama propia por RQ y **PR obligatorio a `18.0-dev`**; se verifica en DEV. PROD es fast-forward a `18.0` revisando el delta de powerfy-docker.
- Módulo nuevo: sumarlo a `TEST_MODULES` y `TEST_TAGS` en `deploy.yml` y `deploy-dev.yml`.
- WEB nunca corre imágenes `dev-*`. En DEMO no tocar `dbfilter` y re-snapshotear el golden tras instalar módulos.
- Overrides Owl del POS: abrir el POS en DEV antes de promover (un xpath roto lo deja sin cargar).
- Sin passwords ni tokens en los repos.

## Circuito a PROD

1. PR de cada repo tocado a `18.0-dev`, con tests locales en verde y revisión; merge del PR.
2. Si no hubo merge en powerfy-docker, `gh workflow run deploy-dev.yml` → DEV.
3. Verificar en DEV y fast-forward a `18.0` → PROD.
4. DEMO (re-snapshot golden) y WEB, a mano vía ECR, si aplica.

## Dónde mirar

- Backlog: `lineamientos-dev-claude-bacg/proyectos/powerfy/backlog.md`, escrito por `rq.mjs`. Origen: `powerfy-docker/ROADMAP.md`.
- Reglas: `lineamientos-dev-claude-bacg/proyectos/powerfy/reglas.md`
