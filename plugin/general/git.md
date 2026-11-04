# Git, ramas y conectores de PROD

## Ramas

- **PROD lo deciden las ramas, no el repo.** Con `ramas_prod` en `proyecto.yml` (en Odoo, típicamente `18.0`), sólo un push o merge a esas ramas es PROD; la rama de DEV (`18.0-dev`) pide tests y revisión, no el OK de PROD.
- **Un push a la rama de DEV puede desplegar** (CI de DEV). Cambios que no deben desplegar (docs, configuración del plugin) van en una rama propia con PR, no directo a la rama de DEV.
- `git pull --rebase` antes de tocar un repo compartido y otra vez antes de pushear. Nunca `--force` sobre una rama de DEV o PROD.

## RQ en varios repos

- Un RQ que toca varios repos del proyecto (por ejemplo, addons y docker) se abre con **el mismo código en cada repo**: el segundo hereda aprobaciones, autonomía, saltos y skills, y lo nuevo se replica solo. Tests, revisión y circuito son de cada repo.
- Los repos se vinculan si están declarados en `proyecto.repos` y clonados uno junto al otro (o con `ruta_local`).

## Conectores MCP de PROD (n8n, Odoo)

- Los servidores MCP que tocan PROD se declaran en `mcp_prod`. Leer pasa siempre; **publicar, editar, ejecutar o borrar** un workflow o registro de PROD pide un RQ activo con el OK de PROD.
- Lo que el plugin no reconoce como lectura se trata como escritura (falla cerrada). Si una herramienta de sólo lectura queda bloqueada, se suma a `lectura` en `mcp_prod`; no se esquiva.
- Desarrollo y pruebas en DEV; a PROD se pasa con el procedimiento de pasaje del proyecto (en n8n, `bacg-n8n-pasaje-prod`).

## Agentes que commitean sin el plugin

- Se declaran en `agentes_externos` (o `lovable` si el proyecto usa Lovable). Sus commits no se reescriben ni se reordenan, y `rq.mjs auditar` los revisa.

## Varias cuentas de GitHub en la misma PC

- Si hay varias cuentas logueadas en `gh`, git toma la credencial de la cuenta activa de `gh` (se ata con `gh auth setup-git`).
- Ante un push o PR que falla, o que sale con otro usuario, chequeá `gh auth status` antes de reintentar.
- **Nunca hagas `gh auth switch` sin avisarle al usuario**: cambia la cuenta activa de todas las sesiones de la máquina.

Por qué: con varias cuentas el push y los commits se desincronizan (se publica con una cuenta y se firma con otra), y un cambio de cuenta silencioso rompe lo que otras sesiones están haciendo.
