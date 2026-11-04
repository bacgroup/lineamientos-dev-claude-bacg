# Changelog

## 1.0.0: base BACG (2026-11-04)

Repo inicial de BACG a partir de `lineamientos-dev` 0.8.0 (mismo núcleo del plugin: ciclo de RQ, compuertas, hooks y CLI `rq.mjs`). Historia nueva, sin los proyectos ni la documentación de terceros.

- Plugin renombrado a `como-trabajo-bacg` y marketplace a `lineamientos-bacg`, para convivir sin choques con instalaciones del repo personal de origen. Las skills pasan a `como-trabajo-bacg:<skill>`.
- Copia de trabajo por defecto: `C:\MiCarpeta\lineamientos-bacg` (Windows) o `~/lineamientos-bacg`; config en `~/.claude/como-trabajo-bacg.json`.
- Proyectos: sólo `powerfy` (más `_plantilla`).
- `docs/ENTORNOS.md`: cómo armar un entorno de Claude Code por proyecto que cargue siempre este plugin y este repo.
