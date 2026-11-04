---
name: decision-arq
description: Usar cuando un RQ toma o revisa una decisión de arquitectura, datos, seguridad o despliegue en un proyecto con .bacg-lineamientos (etapa 1 de diseño y etapa 7 de cierre del ciclo-rq). Decide si corresponde un ADR, lo redacta con contexto, opciones, decisión, consecuencias y estado, lo guarda en proyectos/<id>/adr/ de lineamientos-dev-claude-bacg y lo registra en el grafo con manage_adr.
---

# Decisiones de arquitectura (ADR)

Un ADR deja escrita una decisión que va a seguir pesando cuando nadie se acuerde del RQ que la tomó.

## Cuándo corresponde

Corresponde un ADR si la decisión cambia alguno de estos puntos:

- **Contratos:** APIs, RPC, firmas de edge functions, formatos de archivos o mensajes que consume otro módulo, repo o sede.
- **Datos:** esquema, migraciones con efecto duradero, dueño de una tabla, zona horaria o formato de fechas, fuente de verdad.
- **Seguridad:** RLS, roles, autenticación, manejo de secretos, datos personales.
- **Despliegue:** entornos, circuito de PROD, repos o ramas que publican, sincronización entre repos.
- **Plataforma:** el stack del proyecto o una pieza que se suma (base de datos, backend, front, automatización, ERP, proveedor de IA).

**Decisiones de plataforma.** La arquitectura de referencia histórica (Supabase + Lovable + n8n) es una de las opciones, no la respuesta por defecto. Las opciones del ADR la comparan con las alternativas que el caso justifique: lo que el cliente ya opera (un ERP, un backend propio, otra nube), una base gestionada distinta o un servicio especializado. Ponderá costo, lock-in, quién lo opera y lo mantiene, seguridad y datos personales, y el esfuerzo de migrar después. Si gana otro stack, el ADR dice qué cambia en `proyecto.yml` (`datos`, `ramas_prod`, `entornos`, `agentes_externos`).

No corresponde para un detalle de implementación reversible dentro de un archivo, para una preferencia de estilo ya cubierta por el canon, ni para una decisión que sólo vive en un RQ (esa va a `docs/rq/<código>/decisiones.md`).

Si dudás, preguntale al usuario en una línea: "¿Esto merece ADR? Cambia <qué>."

## Formato

Archivo `.bacg-dev/adr/NNNN-<slug>.md` del repo si el proyecto tiene `.bacg-dev/`; si no, `proyectos/<id>/adr/NNNN-<slug>.md` en la copia de trabajo de lineamientos-dev-claude-bacg (variable `BACG_LINEAMIENTOS_DIR` o `~/.claude/bacg-dev.json`; por defecto `C:\MiCarpeta\lineamientos-dev-claude-bacg`). `<id>` es el proyecto de `.bacg-lineamientos`, `NNNN` es el número siguiente con cuatro dígitos y `<slug>` va en minúsculas con guiones.

```markdown
# NNNN. <Título corto en forma de decisión>

- Fecha: AAAA-MM-DD
- RQ: <código>
- Estado: propuesta | aceptada | reemplazada por NNNN | descartada

## Contexto
Qué problema hay, qué restricciones pesan y por qué hay que decidir ahora.

## Opciones
1. <Opción A>: pros, contras.
2. <Opción B>: pros, contras.

## Decisión
La opción elegida y el motivo, en una o dos frases.

## Consecuencias
Qué se vuelve más fácil, qué se vuelve más difícil, qué hay que mantener y cómo se revierte.
```

## Pasos

1. En la etapa 1, si el diseño trae una decisión de este tipo, redactá el ADR en estado `propuesta` y presentalo junto con el spec. La aprobación del spec por el usuario la pasa a `aceptada`.
2. Guardalo en `proyectos/<id>/adr/` y registralo en el grafo: `manage_adr` de `codebase-memory-mcp`, con el mismo título, estado y resumen de la decisión. Si el MCP no está disponible, avisalo y seguí; el archivo es la fuente.
3. En la etapa 7, revisá si lo implementado cambió algo del ADR y actualizalo (consecuencias reales, estado).
4. En `.bacg-dev/adr/` el ADR va en un commit del RQ (`.bacg-dev/` no es libre). En `proyectos/<id>/adr/` es un doc de lineamientos-dev-claude-bacg: commitealo ahí, separado de los commits del repo del proyecto.

## No reabrir sin el usuario

Un ADR `aceptada` no se reabre ni se contradice por tu cuenta. Si un RQ choca con él, frená y planteáselo al usuario: qué ADR, qué choca y qué opciones hay. Si decide cambiarlo, se escribe un ADR nuevo que lo reemplaza, y el viejo pasa a `reemplazada por NNNN`. No se edita la decisión vieja.
