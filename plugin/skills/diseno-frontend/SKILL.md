---
name: diseno-frontend
description: Usar antes de editar cualquier archivo de UI (ui.patrones de proyecto.yml) en un repo con .lineamientos o .como-trabajo/, en todo RQ o BUG, bounded incluido (la compuerta de edición la exige). Orquesta en orden el canon de UI del proyecto, la auditoría de la pantalla existente (redesign-existing-projects), la base del proceso (emil-design-eng, mobile-native y la propuesta de /prototype al usuario) y sólo donde el proyecto las declara (landing, marca) design-taste-frontend y frontend-design:frontend-design, con la precedencia canon > skill > código vecino. Deja la sección ## Diseño del spec con estados, revisión en móvil y alineación con los componentes vecinos.
---

# Diseño frontend

Todo cambio de UI pasa por esta skill, aunque el RQ sea bounded: una botonera, un color o un tamaño mal elegidos se ven en todas las pantallas. La excepción es un cambio menor que el usuario acepta omitir (ver "Cambio menor"). La compuerta de edición la pide para cada archivo de `ui.patrones`, pide `redesign-existing-projects` si el archivo ya existe y exige la sección `## Diseño` en el spec. Las skills de `ui.skills` y `ui.reglas` del proyecto se suman a estas.

Las de diseño libre (`design-taste-frontend` y `frontend-design:frontend-design`, unos 25 k tokens) se cargan sólo donde el proyecto las declara, típicamente la landing: `design-taste-frontend` está pensada para landings y portfolios, no para tablas ni flujos de gestión.

## Orden

1. **Canon del proyecto.** Leé el canon de UI que declare el proyecto (`ui.canon`: en `.como-trabajo/` del repo, `docs/lineamientos/` o `proyectos/<id>/` de lineamientos-bacg) y las memorias de estilo que nombre. Anotá las reglas que aplican a esta pantalla: tokens, color semántico de las acciones, tipografía, componentes, espaciado, íconos, estados.
2. **Pedido del usuario.** Lo que pidió explícitamente sobre la UI ("color acorde al sentido de la acción", "que entre en una línea") es criterio de aceptación. Va al spec y se verifica en la captura.
3. **`redesign-existing-projects`**, si la pantalla ya existe (la compuerta lo exige). Viene vendorizada como `como-trabajo-bacg:redesign-existing-projects`. Auditá lo que hay antes de cambiarlo: mejorá sobre el stack existente, sin reescribir de cero ni romper funcionalidad.
4. **Base del proceso.** Estas tres van en todo cambio de UI que no sea menor, salvo la excepción que dice cada una:
   - **`emil-design-eng`** (~7 k tokens): el pulido de componentes e interacción. Cubre estados de botones y campos, foco, feedback, jerarquía de acciones y los detalles que el canon no dice. Se omite sólo si el cambio no toca componentes ni interacción, por ejemplo un texto.
   - **`mobile-native`** (~4 k tokens): la revisión a ≤ 400 px del entregable. Cubre viewport y `100vh`, zoom en inputs, hover pegado, áreas táctiles, notch y teclado. Se omite sólo si `reglas.md` del proyecto dice que la app es únicamente de escritorio.
   - **`prototype`**: variantes reales de la pieza, detrás de un selector, para elegir antes de implementar. El agente no la puede invocar (sólo se corre a mano). Cuando el cambio crea una pantalla o un componente, o tiene más de una dirección razonable, proponele al usuario en una línea que corra `/prototype <pieza y restricciones del canon>`. La variante que elija va a `## Diseño`. Si prefiere no hacerlo, seguí con la dirección que propusiste.
5. **`design-taste-frontend`** y **`frontend-design:frontend-design`**, sólo en pantallas de diseño libre que el proyecto declare (landing, páginas públicas, piezas de marca). La primera elige la dirección visual dentro de lo que el canon deja libre; la segunda, la composición, la tipografía y la jerarquía.

Las tres del paso 4 son skills de usuario (`~/.claude/skills`), no vienen con el plugin. Si en esta cuenta o PC no están instaladas, avisalo en una línea y seguí con el canon.

Una skill cargada queda registrada en el RQ: vale para otras sesiones y para subagentes.

## Skills de apoyo según el caso

Además de las del paso 4, éstas son opcionales. Cargá **una** cuando el caso la pide, no todas: cada una suma entre 2 y 4 k tokens. Si no está instalada, seguí sin ella y avisalo en una línea. Si el proyecto quiere exigir alguna para ciertos archivos, la declara en `ui.reglas`.

| Caso | Skill | Para qué |
|---|---|---|
| Datos extremos (el estado que más falla) | `break-ui` | Probar la pantalla con nombres largos, campos vacíos, cifras enormes y listas vacías antes de darla por buena |
| Elegir una librería o un componente | `pick-ui-library`; MCP `shadcn` si el stack usa shadcn/ui  | No inventar un componente que ya existe |
| Landing o marca, según la dirección | `high-end-visual-design` o `minimalist-ui`, como alternativa a `design-taste-frontend` | Una sola dirección, la que pida el canon o el usuario |
| Animación | `animate` (hacer) o `review-animations` (revisar) | Sólo si el cambio anima algo |

Relevamiento del 2026-10-30: las únicas de diseño usadas en las sesiones previas eran `design-taste-frontend`, `frontend-design`, `diseno-frontend`, el canon del proyecto y `redesign-existing-projects`. `emil-design-eng`, `mobile-native` y `prototype` estaban instaladas pero sin uso; desde la 0.8.0 son la base del paso 4.

## Cambio menor: proponer omitir el refuerzo

Si el cambio es menor, no hace falta todo el proceso. Antes de cargar esta skill, preguntale al usuario en el chat, con una pregunta de texto que conteste con sus palabras (no con botones: un botón no queda como frase suya y la compuerta no lo acepta). Por ejemplo: "Es un cambio menor (<qué>). ¿Omito el refuerzo de diseño?". Si acepta, registralo con su frase literal: `$RQ saltar ui "<su frase>" "<motivo>"`. Desde ahí la compuerta pide sólo las skills del canon del proyecto, sin `diseno-frontend`, sin `redesign-existing-projects` y sin la sección `## Diseño`. Si no acepta, seguí el orden de arriba.

Es menor si cumple todo esto:
- un texto, un ícono, un tooltip, un espaciado o un color puntual en una sola pantalla;
- sin componentes ni pantallas nuevas;
- sin cambios de layout ni de lo que se ve en móvil;
- sin tocar algo que se repite en muchas pantallas.

No es menor, aunque sea un solo archivo: un estilo compartido (una botonera, un `.scss` global, un componente base), el color semántico de las acciones, o un cambio que el usuario describió con criterios de diseño. Ante la duda, no lo propongas.

## Precedencia: canon > skill > código vecino

- **Canon:** manda siempre. Si una skill propone algo que el canon prohíbe (otra paleta, otra tipografía, otro patrón de componente), gana el canon.
- **Skill:** cubre lo que el canon no dice. Si la regla parece valer para todo el proyecto, proponé subirla al canon al cierre del RQ.
- **Código vecino:** sirve como ejemplo de implementación, nunca como fuente de reglas. Si el vecino contradice el canon, seguí el canon y anotá la inconsistencia en el spec.md del RQ. No la propagues.

## Entregable

Antes de editar, `docs/rq/<código>/spec.md` tiene una sección `## Diseño` (la compuerta la busca) con:

- las reglas del canon que aplican y el pedido explícito del usuario;
- la dirección elegida y por qué;
- si la pantalla existe, lo que encontró la auditoría;
- los estados de la pantalla: vacío, carga, error y datos extremos;
- **móvil:** cómo se ve a ≤ 400 px de ancho (qué se apila, qué se oculta, que nada salte a una segunda línea sin querer). Si el framework usa plantillas distintas para escritorio y móvil, se revisan las dos;
- **alineación con los vecinos:** los componentes de la misma barra o fila comparten alto, radio, tamaño de letra y línea base. Anotá los valores que tomaste del vecino.

En la etapa 3, los componentes llevan sus tests (en la herramienta de componentes del proyecto). Las pantallas y flujos llevan E2E con captura en escritorio y en móvil (≤ 400 px) en `docs/rq/<código>/qa/`. Antes de dar el diseño por bueno, mirá las capturas contra cada punto de la sección `## Diseño`.
