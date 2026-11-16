# PLG-CLOUD Plan de implementación

> **Ejecución:** `superpowers:executing-plans` en línea. Un commit por tarea con `$RQ commit`.

**Objetivo:** que el plugin funcione en la nube sin mentir ni bloquear de más, y que las escrituras de código por Bash no esquiven la compuerta.

**Arquitectura:**
- Un helper REST (`lib/github.mjs`) reemplaza todas las llamadas `gh pr …`.
- La compuerta de Bash reusa `evaluarEdicion` para lo que escribe.
- El alta, la previa y `odoo-skills` dicen qué no pudieron verificar.

**Spec:** `docs/rq/PLG-CLOUD/spec.md`

## Restricciones globales
- Sin `gh pr …`, `gh auth status` ni GraphQL en el código del plugin.
- Los tests inyectan `gh`/`api`/`git`. Ningún test sale a la red.
- Los RQ sin `reglas: 44` mantienen la compuerta de Bash de la 4.4.0, que sólo protege estado y transcript.
- Español rioplatense en mensajes y comentarios.

## Foco de la revisión
1. Un `gh api` que falla, devuelve no-JSON o tarda: tiene que decir "no consultado", nunca "ninguno".
2. Escritura por Bash a `/tmp` o a docs: no tiene que frenar (es libre o está fuera del repo).
3. `python -c` con un `open` de lectura: no tiene que contar como escritura.
4. Un clon con refspec sólo de `main` y superficial: la previa tiene que ver las ramas `rq/*` de otros.
5. Salida de Odoo mezclada con la de vitest: hay que reconocer las dos.

---

### Tarea 1: `lib/github.mjs` y la previa (S-1, S-4)
- **Crear:** `plugin/scripts/lib/github.mjs`.
- **Modificar:** `previa.mjs`.
- **Test:** `tests/github-rest.test.mjs`.
- **Interfaces:**
  - `api(ruta, { env, correr })` → `{ datos } | { error }`.
  - `prsAbiertos(repo, { base, head }, opts)`.
  - `archivosPr(repo, n, opts)`.
  - `prDeRama(repo, rama, { estado }, opts)`.
  - `checksDe(repo, sha, opts)`.
  - `ramaPorDefecto(repo, opts)`.
  - `cuentaActual(opts)`.
  - `fetchTodasLasRamas(raiz)`.
- [ ] Tests:
  - La previa con `gh` falso muestra los PR y sus módulos.
  - Con error dice "no pude listar los PR" y no "ninguna rama ni PR".
  - Con `BACG_DEV_SIN_GH` dice "PR: no consultados".
  - Las ramas aparecen aunque el clon tenga refspec sólo de `main`.
- [ ] Implementar, `npm test` y commit.

### Tarea 2: el resto de `gh pr` por REST (S-2, S-11)
- **Modificar:** `circuito.mjs`, `rq-rama.mjs`, `promocion.mjs`, `compuerta-bash.mjs` (base y archivos del PR), `rq.mjs` (`entregar`: PR, CI y aviso de compilados) y `ciclo-rq/SKILL.md` (equivalentes REST).
- [ ] Tests:
  - `entregar` con `gh` falso: el PR y los checks salen por REST.
  - Aviso de un compilado tocado por otra `rq/*`.
  - `rq-rama`: rama mergeada detectada por REST.
- [ ] Implementar, `npm test` y commit.

### Tarea 3: el alta en la nube y `odoo-skills` (S-3, S-5, S-6, S-7)
- **Modificar:** `alta.mjs` y `odoo-skills.mjs`.
- **Tests:** `tests/alta-nube.test.mjs` y `tests/odoo-skills.test.mjs`.
- [ ] Tests:
  - `gh api user` ok → paso ok; cuenta distinta → aviso.
  - La copia atrasada después del fetch → aviso; sin red → "no verificado".
  - Plugin sincronizado → cuenta.
  - API de odoo falla → clon anónimo (con `git` inyectado).
- [ ] Implementar, `npm test` y commit.

### Tarea 4: compuertas (S-8, S-9)
- **Modificar:** `compuerta-bash.mjs`, `hooks/pre-tool.mjs` y `rq.mjs` (`abrir --frase`).
- **Tests:** `tests/escritura-bash.test.mjs` y `tests/sin-previa-frase.test.mjs`.
- [ ] Tests:
  - Con reglas 4.4, `cat > src/a.ts`, `sed -i`, `python3 -c "open('src/a.ts','w')"` y `node -e "fs.writeFileSync('src/a.ts')"` se niegan sin el diseño aprobado y pasan con él.
  - `/tmp` y `docs/` pasan.
  - `open(...,'r')` pasa.
  - Sin reglas 4.4, sólo lo de siempre.
  - `abrir --sin-previa` sin `--frase` falla; con la frase del usuario, pasa.
- [ ] Implementar, `npm test` y commit.

### Tarea 5: rojos de Odoo y documentación (S-10, hallazgos 9 a 14, 17 y 19)
- **Modificar:** `cli.mjs` (`fallosDe`), `rq.mjs` (orden de la salida de `abrir`; mensaje de "No tests found"), `ciclo-rq/SKILL.md`, `docs/ENTORNOS.md` y `alta.mjs` (texto del paso de merge).
- **Test:** `tests/rojos-odoo.test.mjs`.
- [ ] Reproducir el 17 con un test de `compuerta-bash`. Si falla, corregir.
- [ ] Implementar, `npm test` y commit.

### Tarea 6: versión 4.5.0, CHANGELOG, README, backlog (PLG-BACKLOG con la propuesta del 8), revisión, E2E y PR
