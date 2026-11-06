# Backlog del plugin lineamientos-dev-claude-bacg

Mejoras del plugin para la arquitectura de BACG (Odoo + n8n + AWS). Vale para todos los proyectos de BACG; las
necesidades que surjan en un proyecto se anotan acá, no en el backlog del proyecto. Independiente del plugin de
origen (`nkick25/lineamientos-dev`): lo que aplique a ambos se lleva a mano.

| Código | Tarea | Prioridad | Estado | Impacto | Link |
|---|---|---|---|---|---|
| PLG-NUBE | Plugin — los tests corren en la PC de cada dev: comandos por PC en ~/.claude/bacg-dev.json (proyectos.<id>.tests) que mandan sobre proyecto.yml; {raiz} y {repo:<nombre>} para rutas portables. | Alta | Hecho 04/11/2026 | Colaboración · Tests | docs/ENTORNOS.md |
| PLG-MCP | Plugin — compuertas MCP para el stack BACG: hoy sólo frenan Supabase y Lovable. Sumar n8n de PROD (publicar o editar workflows productivos) y escrituras a Odoo de PROD vía conector MCP, con el mismo criterio (RQ activo + OK de PROD). | Alta | Hecho en el plugin 04/11/2026 (mcp_prod, falla cerrada). Falta: declarar en powerfy/proyecto.yml los nombres reales de los conectores n8n y Odoo de PROD | Seguridad · PROD | plugin/scripts/lib/compuerta-mcp.mjs |
| PLG-MULTI | Plugin — RQ multi-repo con estado compartido (handoff P5.2): un RQ que toca powerfy-addons y powerfy-bi hoy se abre, aprueba y registra skills dos veces. Repo principal con `estado.yml` y los demás lo referencian. | Alta | Hecho 04/11/2026 | Proceso · Tokens | CHANGELOG |
| PLG-SKILLS | Plugin — skills de BACG en la tabla por etapa de `ciclo-rq` y en los requisitos por stack (bacg-agent-architecture en diseño, bacg-n8n-guidelines al tocar n8n, bacg-n8n-pasaje-prod en el circuito, bacg-diagnostico-bugs en BUG, odoo-multicompany-consultant en Odoo). Hoy el plugin no nombra ninguna. | Media | Hecho 04/11/2026 (tabla en ciclo-rq y skills_requeridas por proyecto) | Proceso · Calidad | plugin/skills/ciclo-rq/SKILL.md |
| PLG-STACK | Plugin — arquitectura de referencia BACG (Odoo + n8n + AWS) como valor por defecto y ejemplo de la plantilla, en lugar de Supabase + Lovable heredado. | Media | Hecho 04/11/2026 (Odoo por defecto; Supabase sólo si se declara) | Arquitectura | plugin/scripts/lib/stack.mjs |
| PLG-CT | Plugin — los repos del producto no llevan archivos del plugin: se reconocen por su remoto origin (cuenta_github + repos[].nombre de proyecto.yml) y el setup del entorno habilita el plugin a nivel usuario. | Alta | Hecho 04/11/2026 | Colaboración · Producto limpio | docs/ENTORNOS.md |
| PLG-REQ | Plugin — plugins requeridos configurables por proyecto: hoy son fijos (incluye `typescript-lsp` y `frontend-design`); PowerFy es Python/Odoo y pide herramientas que no usa. | Baja | Pendiente | Tokens · DX | plugin/scripts/lib/hooks/session-start.mjs |
| PLG-GH | Plugin — el aviso de cuenta de gh no considera `GH_TOKEN` (entornos en la nube): el test falla ahí y el aviso no salta. Aislar el test y definir el comportamiento en la nube. | Baja | Pendiente | Tests · Nube | tests/hooks.test.mjs |

| PLG-ID | Plugin — identidad propia para convivir con el plugin de origen en la misma PC: plugin lineamientos-dev-claude-bacg, comandos /bacg-rq y /bacg-estado, marcador .bacg-lineamientos, carpeta .bacg-dev/, BACG_LINEAMIENTOS_DIR y ~/.claude/bacg-dev.json. | Alta | Hecho 04/11/2026 | DX · Seguridad | README.md#convive-con-el-plugin-de-origen |

| PLG-PR | Plugin — ramas_solo_pr: push directo a la rama de DEV bloqueado; se converge por PR (PowerFy: 18.0-dev). | Alta | Hecho 04/11/2026 | Colaboración · Proceso | proyectos/powerfy/reglas.md |
| PLG-ALTA | Plugin — stepper de alta (/bacg-alta, rq.mjs alta): verifica en orden Node, gh, lineamientos, repo, tests de la PC y su script; el arranque avisa y abrir no abre RQ mientras falte un paso obligatorio. | Alta | Hecho 04/11/2026 | Onboarding | README.md#primer-uso-bacg-alta |
| PLG-PREVIA | Plugin — validación previa al abrir un RQ: fetch de los repos del proyecto, atraso contra la rama de DEV, ramas y PR abiertos de otros (con módulos) y backlog remoto; no abre un código ya tomado. | Alta | Hecho 04/11/2026 | Colaboración · Proceso | plugin/scripts/lib/previa.mjs |
| PLG-PROY | Plugin — proyecto explícito: abrir dice qué proyecto y repo detectó; repo en dos proyectos frena; fuera de un repo, el agente pregunta en qué proyecto se trabaja. | Media | Hecho 04/11/2026 | DX · Multi-proyecto | plugin/skills/ciclo-rq/SKILL.md |
| PLG-ODOO | Plugin — skills oficiales de Odoo (odoo/odoo 20.0 skills/): instalación con rq.mjs odoo-skills, paso del alta y exigencia por etapa según lo que el RQ toca dentro de un addon. | Alta | Hecho 04/11/2026 | Calidad · Odoo | plugin/scripts/lib/odoo-skills.mjs |
