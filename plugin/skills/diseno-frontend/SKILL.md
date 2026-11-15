---
name: diseno-frontend
description: Usar antes de editar cualquier archivo de UI (ui.patrones de proyecto.yml) en un repo con .bacg-lineamientos o .bacg-dev/, en todo RQ o BUG, Acotado incluido, o cuando el usuario pide una pantalla, un rediseño, un flujo, "igual que X" o un ajuste visual. Exige, antes de editar, leer entera la pantalla de referencia, el inventario de paridad, el journey del usuario paso a paso y un mockup navegable estilo Figma, con el canon del proyecto por encima de toda skill. Deja la sección Diseño del spec con esa evidencia, los estados, el móvil y la alineación con los vecinos.
---

# Diseño frontend

Todo cambio de UI pasa por esta skill, aunque el RQ sea Acotado: una botonera, un color o un tamaño mal elegidos se ven en todas las pantallas. La única excepción es un cambio menor que el usuario aceptó omitir (sección 4 de ciclo-rq: `$RQ saltar ui`). La compuerta de edición pide esta skill para cada archivo de `ui.patrones`, `redesign-existing-projects` si el archivo ya existe y la sección `## Diseño` del spec. Con reglas 4.4, además, busca en esa sección la evidencia de los pasos 1 a 4. Las skills de `ui.skills` y `ui.reglas` del proyecto se suman.

**Lo que se controla es el cumplimiento, no la carga.** Que esta skill esté cargada no prueba nada: lo que prueba el diseño son las subsecciones de `## Diseño` y las capturas de la verificación local. Después de una compactación, la compuerta pide cargar la skill de nuevo, porque el canon vale por contexto.

## Orden (todos los pasos dejan evidencia en `## Diseño`)

1. **Canon del proyecto.** Leé el canon de UI que declare el proyecto (`ui.canon`: en `.bacg-dev/` del repo, `docs/lineamientos/` o `proyectos/<id>/` de lineamientos-dev-claude-bacg) y las memorias de estilo que nombre, incluidas las de dominio de la superficie (disponibilidad, proyección, cobros…). Anotá las reglas que aplican a esta pantalla: tokens, color semántico de las acciones, tipografía, componentes, espaciado, íconos y estados.
2. **Referencia entera** → `### Referencias leídas`. La pantalla o el componente equivalente que ya existe (el flujo que se reemplaza o la pantalla hermana de gestión, no el portal del cliente), leído **entero**: archivo, componente y líneas. Antes de diseñar, sacá una captura de la superficie real (`docs/rq/<código>/qa/ref-<pantalla>-<ancho>.png`): si la memoria del canon no coincide con la app, se corrige en el mismo RQ. Si no hay referencia: "no aplica — motivo".
3. **Paridad** → `### Paridad`. Si el RQ reemplaza un flujo o convive con él, armá una fila por cada campo, decisión, modal, paso posterior ("después de confirmar"), navegación (volver) y cálculo del flujo viejo, con dónde queda en el nuevo y cómo: `reusa` (importa la misma función o componente), `reimplementa` (con justificación) o `fuera` (con la frase del usuario). Los filtros y gestos de la superficie de referencia también son filas. Si no reemplaza nada: "no aplica — motivo".
4. **Journey y mockup** → `### Journey` y `### Mockups`. Es obligatorio en todo cambio que no sea menor, porque sin él se toman decisiones funcionales a ciegas sobre el paso a paso del usuario.
   - **Journey:** el recorrido del usuario, paso a paso, con 3 pasos o más: rol, pantalla, qué decide, qué datos ve o carga, y qué pasa después de confirmar.
   - **Mockup navegable estilo Figma:** las pantallas del journey enlazadas, que se recorren con clics. Es un HTML en `docs/rq/<código>/mockups/` con componentes y datos reales del proyecto cuando se puede, o el link de Figma si el proyecto diseña ahí.
   - Si hay más de una dirección razonable, 2 o 3 variantes lado a lado, con una tabla corta (clics para el caso típico, campos a la vista, qué reusa, qué rompe del canon) y tu recomendación.
   - El usuario elige y su elección va a `### Mockups` con su frase. Si después pide cambios sobre la misma pieza, cada punto va a `$RQ devolucion`.
   - **El mockup y `/prototype` definen layout, flujo y dirección, nunca estilos.** Los estilos salen del canon y de la referencia del paso 2.
5. **`redesign-existing-projects`**, si la pantalla ya existe (la compuerta lo exige). Viene vendorizada como `lineamientos-dev-claude-bacg:redesign-existing-projects`. Auditá contra la referencia y el canon, no contra el prototipo: mejorá sobre el stack existente, sin reescribir de cero ni romper funcionalidad.
6. **Base del proceso:**
   - `emil-design-eng` (~7 k tokens): componentes e interacción. Se omite sólo si el cambio no toca componentes.
   - `mobile-native` (~4 k tokens): el entregable a 400 px o menos. Se omite sólo si `reglas.md` dice que la app es únicamente de escritorio.
   - **`/prototype`** (sólo lo corre el usuario): proponéselo en una línea cuando el cambio crea una pantalla o tiene más de una dirección. Su variante elegida reemplaza el mockup del paso 4 si cubre el journey.
   - Las dos primeras son skills de usuario (`~/.claude/skills`). Si no están instaladas, decilo en una línea; el canon y los pasos 1 a 4 siguen siendo obligatorios.
7. **`design-taste-frontend`** y **`frontend-design:frontend-design`**, sólo en pantallas de diseño libre que el proyecto declare (landing, páginas públicas, marca).

Una skill cargada queda registrada en el RQ, pero para editar UI tiene que estar en el contexto en curso.

## Skills de apoyo según el caso

Cargá **una** cuando el caso la pide (entre 2 y 4 k tokens cada una):

| Caso | Skill | Para qué |
|---|---|---|
| Datos extremos | `break-ui` | Nombres largos, vacíos, cifras enormes, listas vacías y filtros con muchos ítems antes de mostrar |
| Elegir librería o componente | `pick-ui-library`; MCP `shadcn` si el stack lo usa | No inventar un componente que ya existe |
| Landing o marca | `high-end-visual-design` o `minimalist-ui` | Una sola dirección |
| Animación | `animate` o `review-animations` | Sólo si el cambio anima algo |

## Precedencia: canon > referencia > skill > código vecino

- **Canon:** manda siempre. Si una skill o un mockup proponen algo que el canon prohíbe, gana el canon.
- **Referencia:** la pantalla equivalente real manda sobre la memoria y sobre el mockup en lo que el canon no dice.
- **Skill:** cubre lo que no dicen ni el canon ni la referencia. Si la regla vale para todo el proyecto, proponé subirla al canon al cierre, con la frase del usuario. Una línea de canon nunca cita código del mismo RQ.
- **Código vecino:** es un ejemplo de implementación, nunca una fuente de reglas. Si contradice el canon, seguí el canon y anotalo en el spec.

## Entregable: `## Diseño` en `docs/rq/<código>/spec.md`

Antes de editar (la compuerta busca las subsecciones con reglas 4.4):
- `### Referencias leídas`, `### Paridad`, `### Journey` y `### Mockups` (pasos 2 a 4);
- las reglas del canon que aplican y lo que el usuario pidió explícitamente (es criterio de aceptación);
- la dirección elegida y por qué; si la pantalla existe, lo que encontró la auditoría;
- los estados: vacío, carga, error y datos extremos;
- el móvil, a 400 px o menos: qué se apila, qué se oculta y que nada salte a una segunda línea sin querer;
- la alineación con los vecinos: alto, radio, tamaño de letra y línea base compartidos.

Al cerrar el desarrollo, la verificación local (`$RQ verificar --local`) lleva capturas a 390, 768 y 1280 de la pantalla nueva y la `ref-*.png` de la referencia en el mismo estado, para compararlas lado a lado. Antes de mostrar nada, mirá las capturas contra cada punto de `## Diseño` y del mockup aprobado. Los comportamientos (encabezado fijo, scroll, clic) se prueban con la interacción, no a ojo.
