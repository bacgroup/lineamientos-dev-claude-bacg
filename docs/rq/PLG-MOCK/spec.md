# PLG-MOCK · El mockup se pregunta cuando el cambio de UI es técnico o chico
Tipo: RQ · Clasificación: Acotado · Repos: lineamientos-dev-claude-bacg
## Qué / Síntoma
Con reglas 4.4, todo RQ que edita un archivo de UI exige `### Mockups` (mockup navegable o Figma) antes del primer cambio. Hoy hay dos extremos: el refuerzo completo o el "cambio menor" (`saltar ui`), que apaga todo el refuerzo. Falta el punto medio.
## Por qué / Esperado vs. actual
Pedido del usuario (18/11): en RQ muy técnicos, de backend con un retoque de pantalla o con un cambio mínimo en una pantalla, el mockup es fricción sin valor. Esperado: el agente pregunta y el usuario decide; si dice que no, queda registrado con su frase y la compuerta lo acepta. Actual: el mockup es obligatorio o se saltea todo.
## Alcance (dentro / fuera)
Dentro: salto `mockup` en la CLI, la compuerta de diseño que lo respeta, textos de ciclo-rq, diseno-frontend y el aviso de la compuerta; tests.
Fuera: el journey, las referencias, la paridad y las capturas de la verificación local siguen exigidos; `saltar ui` (cambio menor) no cambia; un RQ sin archivos de UI ya no pide mockup y sigue igual.
## Toca: UI [ ] · sensible [ ] · migraciones [ ] · varias sedes [ ]
## ARQ: no aplica — cambio de una compuerta existente, sin contratos, datos ni despliegue
## Criterio de aceptación → flujo E2E que lo prueba
1. Con `saltar mockup` registrado con frase del usuario, la compuerta deja editar UI sin `### Mockups` y sigue pidiendo `### Journey`, `### Referencias leídas` y `### Paridad` → tests/journey-mockups.test.mjs.
2. Sin el salto, el aviso de la compuerta ofrece la pregunta del mockup además de la de cambio menor → mismo archivo.
3. `saltar mockup` sin frase del usuario se niega como cualquier salto → tests de saltos existentes.

## Diseño
- **Nuevo salto `mockup`** en la lista de compuertas de `rq.mjs` (`$RQ saltar mockup "<frase>" "<motivo>"`), con la misma validación de frase que los demás saltos (texto literal del usuario en la sesión, un uso por frase).
- **Compuerta:** `faltasDisenoUi(raiz, codigo, { sinMockup })` no exige `### Mockups` si hay salto `mockup` válido. Lo demás de `## Diseño` se sigue exigiendo. El mensaje de la compuerta, cuando falta el mockup, suma una pista: "si el cambio es técnico o chico, preguntale al usuario si hace falta mockup; con su respuesta: `$RQ saltar mockup …`".
- **Cuándo se pregunta (skills):** en el paso 4 de `diseno-frontend` y en la sección 4 de `ciclo-rq`: si el RQ es mayormente técnico o de backend con un retoque de pantalla, o el cambio en la pantalla es chico (sin pantalla nueva ni cambio de flujo), el agente **pregunta** en el chat, con texto, si hace falta mockup, con una línea de por qué cree que no. El usuario decide. A diferencia del cambio menor, ante la duda se pregunta (no se omite la pregunta). Con pantalla nueva o flujo nuevo no se ofrece.
- `### Mockups` queda con "no aplica — decidido por el usuario: «<frase>»" para que el spec lo muestre; la compuerta mira el salto, no el texto.
- Versión del plugin: menor (4.7.0) junto con los demás RQ de la tanda, changelog al cerrar.

## Tareas
1. Test rojo en `tests/journey-mockups.test.mjs`: con salto `mockup`, la compuerta deja pasar sin mockup y sigue exigiendo journey; sin salto, el aviso menciona `saltar mockup`.
2. `rq.mjs`: `mockup` en `COMPUERTAS`; ayuda de la CLI.
3. `diseno-ui.mjs` + `compuerta-edicion.mjs`: respetar el salto y sumar la pista al mensaje.
4. Textos: `ciclo-rq` (tabla 2.1 y sección 4), `diseno-frontend` (paso 4).
5. Suite completa en verde.
