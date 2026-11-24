# Handoff para el plugin dev-fullflow: que el ciclo no queme minutos de GitHub Actions

Fecha: 2026-11-23 · Repo del plugin: `nkick25/dev-fullflow` (versión analizada: 4.7.0, caché local)
Origen: aviso de GitHub a la org `ahraiautomation` por pasar los 2000 min/mes de Actions (plan Free).

## Qué pasó (datos de CRM_AHRAI, 1 al 23/11/2026)

- **≈2102 min facturables**, todos del repo privado `CRM_AHRAI`. El CI completo (`app` + `db` + `e2e`) cuesta unos 16 min por corrida.
- **2026 min** salieron de pushes y PRs hechos por el ciclo RQ (actor `nkick25`).
- De 68 corridas del CI por push a `main`, **28 fueron de commits que solo traían docs**, la mayoría escritos por el ciclo. Son unos 450 min.
- Commits `docs(...)` en `main` en noviembre, por tipo: `cierre` 35, `OK de PROD` 11 + `OK de PROD registrado` 6, `revisión registrada` 8, `prioridad e impacto en el back(log)` 6, `E2E completo en verde` 4, `revisión ok` 3, `traza` 3, `revisión y E2E registrados` 3, `capturas finales y verificación` 3…
- Un solo RQ (UX-13) dejó 4 pushes de docs a `main` después del merge: verificación local, OK de PROD, cierre y lineamientos sincronizados. Cada push disparó el CI completo.
- El pico fue el 19/11: 708 min en un día con varios RQ cerrados.

En el proyecto se arregla por separado: un RQ en CRM_AHRAI agrega `paths-ignore` para docs y `concurrency` a su `ci.yml`. Este handoff es para que el plugin deje de generar el problema en cualquier proyecto, tenga o no ese filtro.

## Dónde está en el plugin

- `scripts/rq.mjs:1434`: `cerrar` hace `git commit -m "docs(<código>): cierre"` y avisa "Falta el push (sólo docs: no necesita RQ)".
- `skills/ciclo-rq/SKILL.md:226`: después del cierre manda a hacer `git push`.
- Los registros intermedios (OK de PROD, revisión, E2E, traza, capturas) los commitea el agente según la skill y, en la práctica, cada uno sale en su propio push a `main` después del merge.
- `general/resumen.md` dice "un solo commit de docs" al cierre, pero lo que pasa en la práctica son varios commits y varios pushes.

## Qué proponemos (a decidir en el repo del plugin)

1. **Juntar los pushes de docs.** Los registros posteriores al merge (OK de PROD, sync, verificación) se commitean pero no se pushean hasta `cerrar`, que hace un solo push. Antes del merge, que vayan en la rama del RQ, porque ahí corren igual con el CI de la PR.
2. **`[skip ci]` en los commits que solo tocan docs** que haga la CLI, como el de `cerrar`, y que la skill le indique lo mismo al agente para sus commits `docs(...)`. GitHub saltea `push` y `pull_request` con `[skip ci]` en el mensaje del commit. Ojo: si el proyecto tiene checks obligatorios en la rama, un commit salteado puede dejar una PR esperando. Conviene condicionarlo a `proyecto.yml` (por ejemplo `ci.skip_docs: true` por defecto, o detectar ramas con PR obligatorio).
3. **Plantilla de CI para proyectos nuevos.** Si `proyectos/_plantilla/` trae o recomienda un workflow, que incluya `paths-ignore: ['docs/**', '**/*.md']` en `push` y `pull_request` y `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
4. **Opcional: chequeo en el arranque.** Que el arranque avise si el CI del proyecto no ignora `docs/**`, con una línea del estilo "cada commit de docs del ciclo corre el CI completo".
5. **Opcional: compuerta de push.** Si lo que se va a pushear son solo docs y ya hay otro push de docs pendiente del mismo RQ, que sugiera esperar al cierre.

## Cómo verificar

- Test de `rq.mjs cerrar`: el commit lleva `[skip ci]` cuando el proyecto lo permite y no lo lleva cuando no.
- En un proyecto de prueba, un RQ completo deja como máximo **1 push de solo docs a `main`** después del merge.
- En CRM_AHRAI, en diciembre: contar las corridas del CI con `head_commit` `docs(` (hoy 28/68). El objetivo es 0, sumado al `paths-ignore` del proyecto.

## Cómo medirlo de nuevo

```bash
gh api --paginate "repos/ahraiautomation/CRM_AHRAI/actions/runs?per_page=100&created=>=2026-12-01&event=push" \
  -q '.workflow_runs[] | select(.name=="CI") | (.head_commit.message|split("\n")[0])' | grep -c '^docs'
```

Los minutos por job se calculan sumando `ceil((completed_at - started_at)/60)` de `actions/runs/<id>/jobs`. La página de billing de la org necesita el scope `admin:org` en `gh`.
