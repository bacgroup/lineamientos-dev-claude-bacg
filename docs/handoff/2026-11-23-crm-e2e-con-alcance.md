# Handoff · Que el plugin deje los tests con alcance en cada proyecto

Fecha: 2026-11-23 · Origen: sesión en CRM AHRAI (rama `rq/UX-22`) · Para: quien mantiene el plugin de origen (`lineamientos-dev-claude-bacg`); dev-fullflow lo recibe por la derivación (`docs/handoff/mantenimiento-desde-bacg.md`).

## El problema

Cada RQ corría el E2E completo en cada `rq.mjs verificar`. Son 39 specs en CRM AHRAI y unos 20 en PunAPP, y se corrían varias veces por RQ: tras cada corrección de la revisión y otra vez antes de PROD. Eso gastaba tiempo, máquina y tokens, y el lock de E2E dejaba a las otras sesiones esperando.

El plugin ya resuelve esto desde el ciclo nuevo (CHANGELOG: `verificar [--completo] [<specs>…]`):

- `tests.e2e` con `{specs}`: `verificar` corre sólo los specs del RQ, los de su diff o los que se le pasan.
- `--completo`: corre la suite completa una vez antes de PROD (`compuerta-bash.mjs`, la compuerta niega PROD con `completo: false`).
- `tests.unit` con `{archivos}`: `commit` corre sólo los tests de lo que está en stage.

**La falla está en la configuración de los proyectos, no en el motor.** El placeholder es opcional y sin él `conSpecs` (`lib/cli.mjs`) corre la suite entera sin avisar. Los dos proyectos se dieron de alta con `e2e: "npx playwright test"`, y nada del plugin lo señaló:

- El paso 8 del alta (`lib/alta.mjs`, id `tests`) marca `ok` si existe `tests.unit`. No mira si lleva `{archivos}` y no revisa `tests.e2e`.
- `arranque` y `estado` no avisan.
- `verificar` no dice que corrió la suite completa porque faltaba el placeholder.

Unit se corrigió a mano en los dos proyectos: en CRM por los timeouts de la suite (PIP-08, 21/11). El E2E quedó sin acotar hasta hoy.

## Ya hecho en los proyectos (2026-11-23, sin commitear)

- CRM AHRAI, `.dev-fullflow/proyecto.yml`: `e2e: "npx playwright test {specs}"`.
- PunAPP (`pilates-flow-portal`), `.dev-fullflow/proyecto.yml`: lo mismo.

Los dos tenían ya `unit: "npx vitest related --run {archivos}"`. Hay que commitearlos dentro de un RQ de cada repo, o como cambio de config si la compuerta lo deja.

## Qué pedirle al plugin

1. **Alta (`lib/alta.mjs`, paso 8):** separar la revisión de tests en dos ítems y no darlos `ok` sin alcance.
   - `tests-unit-alcance`: `tests.unit` sin `{archivos}` queda como "mejorable", con el `como` para agregarlo.
   - `tests-e2e-alcance`: `tests.e2e` declarado sin `{specs}`, lo mismo, con el ejemplo del runner del proyecto (`npx playwright test {specs}`, `node qa/e2e.mjs {specs}`).
   - Recomendado y no obligatorio: un runner que no acepta specs sueltos puede seguir sin placeholder.
2. **`arranque` / `estado`:** una línea cuando falte el placeholder: "tests.e2e corre la suite completa en cada verificar: agregá {specs}". El arranque ya informa si el entorno del E2E está listo, así que va al lado.
3. **`verificar` sin `{specs}`:** decir en la salida que corrió la suite completa por falta de placeholder, y cuánto tardó.
4. **Uso de `--completo`:** guardar en `estado.yml` cuántas corridas completas hubo (`e2e_completos`) y que `estado` avise si son más de una antes de la etapa 5. En `ciclo-rq`, dejar explícito que `--completo` va una sola vez, justo antes de pedir el OK de PROD, y nunca después de cada corrección.
5. **RQ que toca pantallas sin tocar specs:** hoy `specsDelRq` sólo toma specs del diff. Si no hay ninguno, `verificar` corta y el agente tiende a resolverlo con `--completo`. Opción: un `tests.e2e_mapa` opcional en `proyecto.yml` (glob de código → specs; por ejemplo `src/components/quotes/** → e2e/quotes.spec.ts`) que `specsDelRq` sume a los del diff. Si no lo vale, que el mensaje de error sugiera elegir los specs de la pantalla tocada en lugar de `--completo`.
6. **Plantilla (`proyectos/_plantilla/proyecto.yml`):** ya trae `{archivos}` y `{specs}`. Sumar una línea de comentario que diga que sin el placeholder se corre la suite completa siempre.

## Cómo probarlo

- Tests del plugin: `alta` con un `proyecto.yml` sin `{specs}` da "mejorable" en `tests-e2e-alcance`, y con `{specs}` da "ok". `verificar` sin placeholder imprime el aviso. `estado` con dos corridas completas antes de la etapa 5 avisa.
- Después de portar a dev-fullflow, correr `/dff-alta` en CRM AHRAI y en PunAPP: los dos ítems tienen que dar ok.
