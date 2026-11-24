# CI sin minutos de más (PLG-CI-MIN)

El ciclo deja varios commits de sólo docs por RQ (estado, traza, revisión, OK de PROD, cierre). Si cada uno dispara el
CI completo, un proyecto chico pasa el cupo de GitHub Actions: en un proyecto medido, 28 de 68 corridas del CI en un
mes fueron de commits de sólo docs (≈450 min).

## Lo que ya hace el plugin

- Los commits de sólo docs de la CLI (`$RQ commit` y `cerrar`) llevan `[skip ci]` **sólo si todo lo que falta subir
  también es de docs**. GitHub decide mirando el commit de punta del push o del PR: si lleva la marca, no corre ningún
  workflow `push` / `pull_request`, aunque debajo viajen commits de código. Por eso la CLI no marca si, respecto de
  la rama de DEV, las de PROD o la rama por defecto del remoto, el commit viaja con código (la punta de un PR es el
  último commit de la rama: aunque el código ya se haya subido, el CI del PR se saltearía), ni si no puede resolver
  ninguna de esas ramas. Docs, para esto, son los textos, registros y capturas de `docs/` y los `.md` de la
  raíz; un SQL o un script en `docs/`, y los `.md` de `.bacg-dev/` o del producto, no.
- Con checks obligatorios en la rama, un commit salteado puede dejar un PR esperando: en ese caso declará
  `ci: { skip_docs: false }` en `proyecto.yml`.
- El arranque avisa los workflows `on: push` / `pull_request` que corren con commits de docs, los que dejan afuera
  `.bacg-dev/` y los tests que leen archivos de `docs/` que el filtro deja afuera.
- La skill `ciclo-rq` pide un solo push de docs después del merge: el de `cerrar`.

## Filtro recomendado para el workflow del proyecto

`paths-ignore` no admite excepciones (`!`). Si la suite lee algún archivo de `docs/` (un SQL o un handoff guardado por el
ciclo), usá `paths:` con orden: primero todo, después las exclusiones y al final lo que hay que volver a incluir (gana el
último patrón que coincide).

```yaml
on:
  push:
    branches: [main]
    paths:
      - '**'
      - '!docs/**'
      - '!**/*.md'
      - 'docs/rq/<código>/migracion.sql'   # lo que lee la suite
  pull_request:
    paths:
      - '**'
      - '!docs/**'
      - '!**/*.md'

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

- **Nunca excluyas `.bacg-dev/**`:** ahí están `tests.rojos_conocidos` y los comandos de tests. Si el CI no corre cuando
  cambian, un rojo conocido que se saca aparece en el próximo push de código, atribuido a otro cambio.
- **Revisá los demás workflows con `on: push`** (sincronizaciones a otros repos, despliegues): cada uno excluye lo que no está en su
  alcance (una sincronización que corre por cada push de docs suma jobs sin sentido).
- El aviso del arranque no ve rutas armadas por partes (`path.join(raiz, 'docs', 'x.md')`): revisalas a mano.
