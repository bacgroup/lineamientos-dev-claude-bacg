// PLG-PRREV: el workflow del revisor independiente (claude-code-action + skill revision-pr), renderizado por repo con
// sus ramas de DEV y PROD y los autores de los agentes sin el plugin. Lo instala `rq.mjs revisor-pr`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoresExternos, ramasProd, ramasSoloPr } from './stack.mjs';

const PLANTILLA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plantillas', 'bacg-revisor.yml');
export const RUTA_WORKFLOW = path.join('.github', 'workflows', 'bacg-revisor.yml');

const lista = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;

/** { texto, avisos }: el workflow para este repo. Sin ramas declaradas, la rama por defecto (y lo avisa). */
export function renderRevisor({ proyecto, entradaRepo, ramaDefecto = 'main' }) {
  const avisos = [];
  let ramas = [...new Set([...ramasSoloPr(proyecto, entradaRepo), ...(ramasProd(proyecto, entradaRepo) ?? [])])];
  if (ramas.length === 0) {
    ramas = [ramaDefecto];
    avisos.push(`El proyecto no declara ramas_solo_pr ni ramas_prod: el revisor mira la rama por defecto (${ramaDefecto}).`);
  }
  const autores = autoresExternos(proyecto);
  const push = autores.length ? `  push:\n    branches: ${lista(ramas)}\n` : '';
  const condicion = autores.length
    ? `github.event_name == 'pull_request' || contains(fromJSON('${JSON.stringify(autores).replace(/'/g, "''")}'), github.event.head_commit.author.name)`
    : "github.event_name == 'pull_request'";
  const texto = fs.readFileSync(PLANTILLA, 'utf8')
    .replace('__RAMAS__', lista(ramas))
    .replace('__PUSH__\n', push)
    .replace('__IF__', JSON.stringify(condicion));
  return { texto, avisos };
}

/** Escribe el workflow en el repo. No pisa uno distinto (modificado a mano) sin `forzar`. */
export function instalarRevisor({ raiz, proyecto, entradaRepo, ramaDefecto, forzar = false }) {
  const ruta = path.join(raiz, RUTA_WORKFLOW);
  const { texto, avisos } = renderRevisor({ proyecto, entradaRepo, ramaDefecto });
  let actual = null;
  try {
    actual = fs.readFileSync(ruta, 'utf8');
  } catch {
    // no existe
  }
  if (actual === texto) return { ruta, creado: false, motivo: 'ya está al día', avisos };
  if (actual !== null && !forzar) {
    return { ruta, creado: false, motivo: `${RUTA_WORKFLOW} ya existe y es distinto (¿lo cambiaron a mano?): revisalo y, para reemplazarlo, corré de nuevo con --forzar.`, avisos };
  }
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, texto);
  return { ruta, creado: true, avisos };
}
