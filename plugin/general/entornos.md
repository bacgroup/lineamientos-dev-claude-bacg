# Entornos

Todo cambio recorre **LOCAL → DEV / Preview → PROD**, en ese orden.

| Entorno | Para qué | Quién lo toca |
|---|---|---|
| LOCAL | Desarrollo y tests automáticos | El agente, libremente |
| DEV / Preview | Verificar el cambio desplegado (Playwright, navegador integrado, `get_advisors`) | El agente, sólo al entorno dev declarado en `proyecto.yml` |
| PROD | Usuarios reales | El agente, sólo en la etapa 5 (PROD y entrega), con OK del usuario en la sesión y siguiendo `circuito_prod` |

## Reglas

- **El `.env` local puede apuntar a datos reales.** Antes de correr cualquier cosa que escriba, mirá a qué base apunta; no des por hecho que LOCAL es local.
- **Nunca corras pruebas destructivas contra PROD.** Los tests que borran, truncan o reescriben corren contra la base local o un clon de PROD, nunca contra PROD.
- DEV es lo que declara `entornos.dev`: el **Preview de Lovable** (arquitectura de referencia), una **rama** que despliega a un entorno propio (`tipo: rama`, con `ramas_prod` para que el push a esa rama no cuente como PROD) o una **URL** propia. Un DEV que comparte base con PROD no es aislamiento: tratalo con las reglas de PROD para escrituras.
- Las bases de PROD están en `entornos.prod` de `proyecto.yml` (`supabase_refs` o `bases`). Cualquier SQL de escritura a esas bases está bloqueado fuera de la etapa 5 (PROD y entrega).
- Los procesos sensibles se verifican sobre un clon local de PROD (ver `tests.md`), no sobre PROD.
- Un repo es PROD salvo que figure con `push_prod: false` explícito; con `ramas_prod`, sólo sus ramas de PROD.
- Los secretos de cada entorno se manejan según `seguridad.md`; no se copian de un entorno a otro.

## Windows: junctions y borrado de carpetas

- **Nunca borres con `git worktree remove --force`, `rm -rf` o `Remove-Item -Recurse` una carpeta que contenga una junction** (`mklink /J` o `New-Item -ItemType Junction`): esos comandos siguen el enlace y borran el contenido del destino.
- Primero quitá la junction sola: `cmd //c rmdir "<ruta\node_modules>"` o `(Get-Item <ruta>).Delete()`. Comprobá que el destino sigue intacto y recién después borrá la carpeta.
- Para correr tests de un commit viejo, preferí `git stash` o `git checkout <sha> -- <archivos>` en una copia sin junctions, o quitá la junction antes de limpiar.

Por qué: un worktree temporal con junction a las dependencias del repo principal, borrado con `git worktree remove --force`, vació las dependencias originales. Se recuperó reinstalando, sin perder código, pero cuesta tiempo y pasa en silencio.
