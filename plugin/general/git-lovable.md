# Git con repos conectados a Lovable

Aplica sólo a los proyectos que usan Lovable (`lovable.proyectos` en `proyecto.yml`). Otro agente que commitea sin el plugin se declara en `agentes_externos` y sigue las mismas reglas de convivencia: rebase antes de tocar y antes de pushear, y sus commits no se reescriben.

Lovable edita el repo desde la nube y commitea con su bot (`gpt-engineer-app[bot]`). Para no pisarnos:

- **`git pull --rebase` antes de tocar nada** en un repo de Lovable, y otra vez antes de cada push. Los commits del bot llegan en cualquier momento.
- **`main` es la única rama que Lovable sincroniza.** El trabajo en otras ramas es invisible para Lovable hasta que se mergea a `main`.
- **Push a `main` = publicar.** Lo que entra a `main` lo toma Lovable; en un repo PROD, eso sólo ocurre en la etapa 6 y en el orden de `circuito_prod`.
- **No commitees lockfiles que Lovable maneja** (`package-lock.json`, `bun.lockb`, `bun.lock` y similares): los regenera su entorno y generan conflictos en cada sync. Si un cambio necesita dependencias nuevas, declaralas en `package.json` y dejá que el lockfile siga siendo de Lovable.
- **Los commits del bot de Lovable son a `main`.** Si tu rebase trae commits suyos, no los reescribas ni los reordenes.
- Lovable sólo ve su repo: no puede leer repos hermanos ni la copia central de lineamientos. Lo que necesite saber llega por la copia generada en `docs/lineamientos/` y por Knowledge. (La copia en `docs/lineamientos/` llega con la sincronización: sub-proyecto 2/3.)
- No edites a mano `docs/lineamientos/` ni el bloque entre `<!-- lineamientos:inicio -->` y `<!-- lineamientos:fin -->` de `AGENTS.md`: se generan desde el repo central. (Ambos llegan con la sincronización: sub-proyecto 2/3; hasta entonces no existen.)
- Un push rechazado se resuelve con `git pull --rebase` y revisando el conflicto; nunca con `--force` sobre `main`.

## Varias cuentas de GitHub en la misma PC

- Si hay varias cuentas logueadas en `gh`, git toma la credencial de la cuenta activa de `gh` (se ata con `gh auth setup-git`).
- Ante un push o PR que falla, o que sale con otro usuario, chequeá `gh auth status` antes de reintentar.
- **Nunca hagas `gh auth switch` sin avisarle al usuario**: cambia la cuenta activa de todas las sesiones de la máquina.

Por qué: con varias cuentas el push y los commits se desincronizan (se publica con una cuenta y se firma con otra), y un cambio de cuenta silencioso rompe lo que otras sesiones están haciendo.
