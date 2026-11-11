# Seguridad

## Secretos

- Nunca en el repo: ni claves, ni tokens, ni `service_role`, ni contraseñas, ni en `.md`, ni en `proyecto.yml`, ni en mensajes de commit.
- Los `.env` están en `.gitignore`. Si un secreto se commiteó, se considera filtrado: se rota, no alcanza con borrarlo del historial.
- Una clave pública (anon/publishable) puede ir en el cliente; una de servicio, jamás.
- No pegues secretos en el chat ni en `decisiones.md`, `spec.md` o el changelog.

## RLS

- Toda tabla con datos de usuarios tiene RLS activado.
- **Un test por rol**: para cada política, un caso que debe pasar y uno que debe ser rechazado, por cada rol que el proyecto defina (incluido el anónimo).
- Las funciones `SECURITY DEFINER` fijan el `search_path` y validan quién llama.
- Después de cada migración: `get_advisors` (seguridad y rendimiento) y atender lo que marque.

## Cuándo aplica `claude-security`

Si el RQ toca rutas de `sensible.rutas` de `proyecto.yml`, se corre un escaneo profundo con la skill `claude-security:claude-security` en la etapa 3 (verificación), antes de pedir PROD. `security-guidance` actúa sola en todos los RQ por hooks al editar; atendé sus avisos antes de registrar la revisión.

## PROD

- La etapa 5 (PROD y entrega) exige el OK explícito del usuario **en la sesión en la que se publica**. Un OK de otra sesión no vale.
- SQL a PROD: sólo `SELECT` de lectura pasa sin etapa. Cualquier escritura va con pre-chequeo de lo que se toca y verificación posterior ("sellado"), en el orden de `circuito_prod`.
- **Un repo es PROD salvo `push_prod: false` explícito** en `proyecto.yml`. Si el campo no está, el repo es PROD. Con `ramas_prod`, sólo un push o merge a esas ramas es PROD; si la rama destino no se puede resolver (`--all`, `--mirror`, sin upstream, PR ilegible), también.
- Las compuertas de PROD fallan cerradas: si el hook no puede evaluar, bloquea.
- El modo autónomo nunca llega a PROD.

## Límites conocidos de las compuertas

Las compuertas frenan olvidos y apuros del agente, no a un humano que las esquiva a propósito. Hay cosas que no ven; no las uses como atajo.

**Bash (`git commit`, `git push`, `gh pr merge`).** El parser de shell es aproximado y tiende a fallar cerrado. No se detectan:

- aliases de git (`git -c alias.p=push p`, `alias.*` en la configuración, aliases de shell);
- merges por la API de GitHub con `curl` (un `gh api …/merge` sólo lo frena la red de seguridad si dice "merge" literal) y la variable `GH_REPO` definida fuera del comando;
- pushes desde scripts o programas (`./deploy.sh`, `npm run publicar`, Makefiles, python/node), `GIT_DIR` exportado antes, y comandos armados con variables que no mencionan literalmente git y push;
- archivos de script ejecutados por un shell (`sh x.sh`) y comandos armados en tiempo de ejecución (`"$(echo git)" push`).

Falsos positivos aceptados (fallan cerrados):

- un subcomando desconocido de git (un alias) o `gh api`, `gh alias` y `gh extension` que mencionen push o merge disparan la red; los subcomandos conocidos (`git stash push`, `gh pr checks`) no;
- con un shell sin `-c` (`bash x.sh`), un mensaje de commit entre comillas que diga "git … push" dispara la red del shell.

Lo que la red de seguridad agrega bloquea, pero no cuenta como paso cumplido del circuito de PROD: sólo se registran los pushes y merges que el parser vio.

**Archivos protegidos.** `docs/rq/<código>/estado.yml`, `docs/rq/ACTIVO` y el transcript de la sesión (`~/.claude/projects/*.jsonl`) no se escriben a mano: Edit, Write y MultiEdit se niegan siempre, y desde Bash se niegan las redirecciones de salida (`>`, `>>`, `2>`), `sed -i`, `tee`, `cp` y `mv` hacia ellos. Es best effort: no se ven `dd of=`, `install`, intérpretes (`python -c`, `node -e`), editores ni scripts. Un commit que trae `estado.yml` en stage con aprobaciones, autonomía o saltos nuevos respecto de `HEAD` exige que cada frase esté en un mensaje del usuario de esta sesión.

**MCP (Supabase y Lovable).** Estas compuertas cubren los conectores de Supabase y Lovable. Con otro motor (`datos.motor`), el SQL o la actualización de PROD por CLI o por scripts no tiene compuerta propia: lo cubren el OK de la etapa 5 y el circuito (pasos `sql:<base>` con `entornos.prod.bases`). La lectura de SQL se decide con un chequeo léxico, no con un parser:

- no se detectan funciones invocadas indirectamente por vistas, triggers o reglas, operadores definidos por el usuario ni llamadas con notación de atributo (`(t).f`);
- la lista blanca de funciones se aplica por nombre: una función propia con el mismo nombre que una de la lista, en otro schema del `search_path`, pasaría;
- los `project_id` que no son de PROD (o desconocidos) se permiten;
- un `project_id` se reconoce como de un proyecto propio si está en el registro de lineamientos o en un repo con `.bacg-dev/` debajo de la carpeta de la sesión (hasta dos niveles) o en `proyectos.<id>.raiz` de `~/.claude/bacg-dev.json`; un repo con `.bacg-dev/` en otro lado y sin esa entrada no se ve desde fuera de él. El deploy de Lovable sólo se controla en proyectos que declaran `lovable`;
- si `sql:<ref>` no figura en `circuito_prod`, no hay chequeo de orden.

Tampoco se protege de la edición deliberada de `estado.yml` por caminos que la compuerta no ve, ni de **falsificar el transcript** (escribir en `~/.claude/projects/*.jsonl` con algo que no sea Edit/Write ni las formas de Bash de arriba): las aprobaciones se validan contra ese archivo. Nunca hagas ninguna de las dos cosas.
