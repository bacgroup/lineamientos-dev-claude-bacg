# Reglas del proyecto

Reglas propias de Powerfy. Lo general vive en `general/`; acá va sólo lo que cambia o agrega. Los procedimientos completos están en `powerfy-docker/docs/OPERACION.md`.

## Canon de UI/UX

- Paleta Powerfy: navy `#1C1A2B`, coral `#FE5567`, naranja `#FFB13C`. El violeta `#714B67` es el default de Odoo y no es de marca.
- `logo_white.png` es para fondo blanco (tinta oscura); para fondos oscuros va `logo-powerfy.png`.
- Overrides Owl del POS en `powerfy_theme` (bundle `point_of_sale._assets_pos`); plantillas server-side del POS en `powerfy_theme_pos`.
- Website: editar la vista COW con `website_id=1`, no la genérica. QWeb: `{{...}}`, nunca `#{...}`. Formularios con `data-model_name="crm.lead"`.
- Sitio y producto bilingües es_419 / en_US; español primario.
- Color semántico de acciones: **verde = guardar o confirmar, rojo = descartar o borrar**. El coral de marca no se usa para acciones destructivas, ni el rojo para confirmar.
- Íconos de interfaz: sólo Lucide. Ícono sin texto sólo en móvil o en acciones universales (engranaje, paginador), siempre con `aria-label` y tooltip.
- Íconos de apps: la imagen que trae cada módulo (`web_icon`), sin modificar el archivo, dentro de un marco con estilo Powerfy.
- Toda pantalla se revisa en escritorio y en móvil (Odoo usa plantillas distintas, p. ej. el menú de apps), con captura y alineada con los componentes vecinos de la misma barra.

## Reglas de negocio

- Cada dev trabaja en local en una rama propia (`rq/<código>`), con sus tests corriendo en su PC.
- **A `18.0-dev` se entra sólo por PR** (el plugin niega el push directo): ahí convergen los cambios de todos y se verifica en DEV, el único lugar con la imagen real. Un merge que sólo toca repos de addons no dispara `deploy-dev.yml`: correrlo a mano.
- Módulo nuevo → `TEST_MODULES` (sin `/`) y `TEST_TAGS` (con `/`) en `deploy.yml` y `deploy-dev.yml`: si falta, el CI no lo prueba.
- Traducciones de `arch_db` por SQL (`jsonb_build_object`), no por ORM con `lang`: el ORM pisa los otros idiomas.
- No inicializar una DB con el servicio `odoo` corriendo: la concurrencia rompe con `UniqueViolation`.
- Lógica de host en scripts con timer systemd, no en `ir.cron`: `safe_eval` bloquea `import` y `with`.
- `powerfy_security`: historial de 5 contraseñas y 24 h entre cambios; respetarlo al rotar claves de admin.
- RBAC por `base_user_role` (7 roles de `powerfy_roles`): todo menú o acción nueva se asigna a un rol.
