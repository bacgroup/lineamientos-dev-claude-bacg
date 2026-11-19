# PLG-PRREV · ARQ

**Contexto.** Hace falta una revisión fuera de la sesión que escribió el código, en GitHub, con las reglas del proyecto. Fuentes: code.claude.com/docs/en/github-actions (leído el 18/11/2026): la acción `anthropics/claude-code-action@v1` corre en modo automático con `prompt`, instala plugins por `plugin_marketplaces` + `plugins`, comenta en línea si se le habilita la herramienta y se autentica con `ANTHROPIC_API_KEY` o `CLAUDE_CODE_OAUTH_TOKEN` como secret.

**Opciones.**
| Opción | Pro | Contra |
|---|---|---|
| A. Workflow propio con la acción + skill del plugin (**elegida**) | Usa las reglas, ADR, canon y checklist del proyecto; misma skill para todos los repos; se actualiza con el plugin | Un workflow por repo; secret y minutos de Actions |
| B. Code Review gestionado de Anthropic (sin workflow) | Cero mantenimiento | [Probable] criterios genéricos; no conoce el checklist ni las reglas del ciclo; no se controla qué bloquea |
| C. Prompt copiado en cada repo | No depende de instalar el plugin en CI | Se desactualiza; N copias |

**Decisión.** A. El marketplace es público, así que la acción lo instala sin credenciales extra.

**Atributos de calidad.** Seguridad: el secret vive en GitHub; permisos mínimos (`contents: read`, `pull-requests: write`, `id-token: write`); en repos públicos GitHub no pasa secrets a PR de forks. Costo: `--max-turns`, `concurrency` por PR, push sólo de agentes externos.

**Riesgos.** Falsos positivos que pongan rojo el check → sólo los críticos bloquean y requieren evidencia en el diff. Que el check rojo no frene si no hay protección de rama → se documenta para el admin. Cambios de la acción → versión fijada `@v1`.

**ADR.** Amerita: "Revisión independiente en GitHub con claude-code-action y la skill revision-pr" → `docs/adr/` del plugin al cerrar (decision-arq).
