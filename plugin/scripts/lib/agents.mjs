// Sección de AGENTS.md generada desde .como-trabajo/: los lineamientos en una forma que cualquier agente sin el
// plugin (Lovable, en emergencias o sin tokens) puede seguir a mano. La escribe `rq.mjs agents` entre marcas; el
// resto de AGENTS.md es del proyecto y no se toca.

import fs from 'node:fs';
import path from 'node:path';
import { basesProd, globsMigraciones } from './stack.mjs';

export const INICIO = '<!-- como-trabajo-bacg:inicio (lo genera `rq.mjs agents` desde .como-trabajo/; no editar a mano) -->';
export const FIN = '<!-- como-trabajo-bacg:fin -->';

const lista = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim() !== '') : []);
const codigo = (s) => `\`${s}\``;

/** Texto de la sección (con sus marcas) para el proyecto dado. */
export function seccionAgents(proyecto) {
  const p = proyecto ?? {};
  const tests = p.tests ?? {};
  const canon = typeof p.ui?.canon === 'string' && p.ui.canon ? path.posix.normalize(`.como-trabajo/${p.ui.canon}`) : null;
  const refs = basesProd(p);
  const migs = globsMigraciones(p);
  const sensibles = lista(p.sensible?.rutas);
  const pasos = (Array.isArray(p.circuito_prod) ? p.circuito_prod : []).map((c) => c?.paso).filter(Boolean);
  const l = [
    INICIO,
    '## Cómo trabajamos (como-trabajo): vale para cualquier agente, Lovable incluido',
    '',
    `Proyecto ${p.nombre ?? p.id ?? ''} (${codigo(p.id ?? '?')}). Antes de cambiar código leé ${codigo('.como-trabajo/reglas.md')}${canon ? ` y, si tocás pantallas, el canon de UI ${codigo(canon)}` : ''}. Si una regla de abajo choca con una del proyecto, manda la del proyecto.`,
    '',
    '### Antes de cambiar código',
    '1. Decidí si es **RQ** (funcionalidad nueva o cambio de comportamiento) o **BUG** (algo que anda mal respecto de lo acordado). Consultas, docs y tests sueltos no necesitan nada de esto.',
    `2. Buscá el código en ${codigo('docs/backlog.md')}. Si no está, agregá una fila con el código siguiente de la misma serie: ${codigo('| <código> | <tarea> | <prioridad> | En curso | <impacto> | docs/rq/<código>/ |')}.`,
    `3. Escribí el encuadre en ${codigo('docs/rq/<código>/spec.md')}: qué, por qué (o esperado vs. actual en un BUG), alcance, cómo reproducir (BUG) y el criterio de aceptación con el flujo E2E que lo prueba.`,
    '',
    '### Mientras desarrollás',
    `- Todo cambio de código lleva su test${tests.unit ? ` (${codigo(tests.unit.replace('{archivos}', '<archivos>'))})` : ''}. En un BUG, primero el test que reproduce el error.`,
    tests.e2e
      ? `- E2E obligatorio: agregá o actualizá un flujo en ${codigo('e2e/')} que recorra el cambio (${codigo(tests.e2e)}${tests.e2e_url ? `, app en ${codigo(tests.e2e_url)}` : ''}). Corre contra la base local, nunca contra PROD.`
      : '- El proyecto todavía no tiene E2E automatizado: describí en el spec cómo verificarlo.',
    ...(sensibles.length ? [`- Rutas sensibles (revisión extra y tests de todos los casos): ${sensibles.map(codigo).join(', ')}.`] : []),
    `- Nunca commitees ${codigo('.env')}, lockfiles, ${codigo('.claude/')} ni ${codigo('.como-trabajo/')} (la configuración del proyecto la cambia sólo un RQ con el plugin).`,
    '',
    '### Base de datos y PROD',
    ...(refs.length
      ? [
          `- Bases de PROD: ${refs.map(codigo).join(', ')}. Desde este agente no apliques migraciones ni SQL de escritura en ellas: ${migs.length ? `dejá la migración en ${migs.map(codigo).join(', ')} y` : 'describí el cambio de datos en el spec y'} anotá en el spec que falta aplicarla. La aplica el circuito de PROD con el OK del usuario.`,
        ]
      : ['- El proyecto no declara bases de PROD: cualquier cambio de datos de producción pasa por el usuario.']),
    ...(pasos.length ? [`- Circuito de publicación: ${pasos.map(codigo).join(' → ')}.`] : []),
    '',
    '### Al terminar',
    `- Agregá la entrada al changelog del mes ${codigo('docs/log/changelog/AAAA-MM.md')}: ${codigo('### AAAA-MM-DD · <código> · <título>')} y debajo las líneas "Qué cambió", "Dónde" y "Alcance".`,
    `- Agregá una línea JSON a ${codigo('docs/log/rq.jsonl')} con ${codigo('fecha')}, ${codigo('codigo')}, ${codigo('tipo')}, ${codigo('titulo')}, ${codigo('resumen')} y ${codigo('"via": "<agente>"')}.`,
    `- Pasá la fila del backlog a ${codigo('Hecho <dd/mm/aaaa>')}.`,
    '',
    `Todo commit que llegue a la rama principal sin pasar por esto queda en la auditoría (${codigo('rq.mjs auditar')}) y se regulariza después como RQ o BUG.`,
    FIN,
  ];
  return `${l.join('\n')}\n`;
}

/** Escribe la sección en AGENTS.md (la reemplaza entre las marcas o la agrega al final). Devuelve 'creado' | 'actualizado' | 'agregado' | 'igual'. */
export function escribirAgents(raiz, seccion) {
  const archivo = path.join(raiz, 'AGENTS.md');
  if (!fs.existsSync(archivo)) {
    fs.writeFileSync(archivo, `# AGENTS\n\n${seccion}`);
    return 'creado';
  }
  const texto = fs.readFileSync(archivo, 'utf8').replace(/\r\n/g, '\n');
  const i = texto.indexOf(INICIO.slice(0, 24));
  const j = texto.indexOf(FIN);
  let nuevo;
  let r;
  if (i !== -1 && j !== -1 && j > i) {
    nuevo = `${texto.slice(0, i)}${seccion}${texto.slice(j + FIN.length).replace(/^\n/, '')}`;
    r = 'actualizado';
  } else {
    nuevo = `${texto.replace(/\s*$/, '')}\n\n${seccion}`;
    r = 'agregado';
  }
  if (nuevo === texto) return 'igual';
  fs.writeFileSync(archivo, nuevo);
  return r;
}
