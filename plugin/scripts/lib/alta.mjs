// Alta del desarrollador (stepper de primer uso): verifica, en orden, todo lo que hace falta para trabajar el primer
// RQ y dice qué hacer en el primer paso que falta. Lo usan `rq.mjs alta` (/bacg-alta), el arranque de sesión (aviso
// corto) y `rq.mjs abrir` (no abre un RQ con un paso obligatorio pendiente).
//
// Cada paso: { n, id, titulo, estado: 'ok' | 'falta' | 'aviso' | 'na', obligatorio, detalle?, como? }.
// 'falta' en un paso obligatorio bloquea; 'aviso' orienta pero no bloquea; 'na' no aplica (p. ej. fuera de un repo).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirConfigClaude } from './sesiones.mjs';
import { spawnSync } from 'node:child_process';
import { buscarRepo, cargarProyecto, configEnRepo, dirLineamientos, nombreRepo, ajustesLocales } from './config.mjs';
import { reposHermanos } from './multi-repo.mjs';
import { PLUGINS_REQUERIDOS } from './hooks/session-start.mjs';
import { estadoSkillsOdoo, ramaSkills, usaOdoo, tieneAddons } from './odoo-skills.mjs';
import { fileURLToPath } from 'node:url';
import { higienePlugins, textoCandidato, bloqueApagar } from './higiene.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'rq.mjs');

const REPO_CENTRAL = 'bacgroup/lineamientos-dev-claude-bacg';
const lista = (x) => (Array.isArray(x) ? x : []);

const sh = (cmd, args, opts = {}) => {
  try {
    return spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  } catch {
    return { status: 1, stdout: '', stderr: '' };
  }
};

/** Primer archivo que nombra un comando de tests (ruta entre comillas o token con extensión de script), o null. */
export function scriptDelComando(comando) {
  if (typeof comando !== 'string') return null;
  const c = comando.replace(/\{(archivos|specs)\}/g, '');
  const comillas = c.match(/"([^"]+\.(?:mjs|cjs|js|ts|py|sh|ps1))"/i);
  if (comillas) return comillas[1];
  const token = c.split(/\s+/).find((t) => /\.(?:mjs|cjs|js|ts|py|sh|ps1)$/i.test(t) && !t.startsWith('-'));
  return token ?? null;
}

function bloqueJson(id, tests) {
  return JSON.stringify({ proyectos: { [id]: { tests } } }, null, 2);
}

/**
 * Pasos del alta para la sesión en `cwd`. Opciones para tests: env, home, dirLin, version (de Node), gh (función que
 * devuelve true si gh está autenticado), sinGh (omite el paso de gh).
 */
export function pasosAlta({ cwd = process.cwd(), env = process.env, home = os.homedir(), dirLin, version = process.versions.node, gh, sinGh } = {}) {
  const lin = dirLin ?? dirLineamientos({ env, home });
  const pasos = [];
  const sumar = (p) => pasos.push({ n: pasos.length + 1, ...p });

  // 1. Node
  const mayor = Number(String(version).split('.')[0]);
  sumar({
    id: 'node', titulo: 'Node 22 o más', obligatorio: true,
    estado: mayor >= 22 ? 'ok' : 'falta', detalle: `v${version}`,
    como: 'Instalá Node 22 LTS o más (https://nodejs.org) y abrí una terminal nueva.',
  });

  // 2. gh autenticado
  if (sinGh || env.BACG_DEV_SIN_GH === '1') {
    sumar({ id: 'gh', titulo: 'GitHub CLI autenticado', obligatorio: true, estado: 'na', detalle: 'omitido' });
  } else {
    const ok = typeof gh === 'function' ? gh() : sh('gh', ['auth', 'status'], { env }).status === 0;
    sumar({
      id: 'gh', titulo: 'GitHub CLI autenticado', obligatorio: true, estado: ok ? 'ok' : 'falta',
      como: 'Corré `gh auth login` con una cuenta que vea la org bacgroup (y `gh auth setup-git`).',
    });
  }

  // 3. Copia de lineamientos
  const repo = buscarRepo(cwd, { dirLin: lin });
  const enRepo = repo && configEnRepo(repo.raiz);
  const hayLin = fs.existsSync(path.join(lin, 'proyectos'));
  sumar({
    id: 'lineamientos', titulo: 'Copia de los lineamientos en esta PC', obligatorio: true,
    estado: hayLin || enRepo ? 'ok' : 'falta', detalle: hayLin ? lin : enRepo ? 'configuración en el repo (.bacg-dev/)' : `no está en ${lin}`,
    como: `Cloná el repo central: \`gh repo clone ${REPO_CENTRAL} "${lin}"\`. Si la querés en otra carpeta, poné su ruta en ~/.claude/bacg-dev.json como "lineamientosDir".`,
  });

  // 4. Lineamientos al día (sin red: compara con lo último que se trajo)
  if (hayLin) {
    const r = sh('git', ['-C', lin, 'rev-list', '--count', 'HEAD..@{u}']);
    const atras = r.status === 0 ? Number(r.stdout.trim()) : 0;
    sumar({
      id: 'al-dia', titulo: 'Lineamientos al día', obligatorio: false, estado: atras > 0 ? 'aviso' : 'ok',
      detalle: atras > 0 ? `${atras} commit(s) atrás` : undefined, como: `Corré \`git -C "${lin}" pull\`.`,
    });
  }

  // 5. Plugins requeridos
  let instalados = null;
  try {
    instalados = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(dirConfigClaude({ env, home }), 'plugins', 'installed_plugins.json'), 'utf8'))?.plugins ?? {}));
  } catch {
    // sin el archivo: no se puede saber
  }
  const faltan = instalados ? PLUGINS_REQUERIDOS.filter((p) => !instalados.has(p)) : [];
  sumar({
    id: 'plugins', titulo: 'Plugins complementarios', obligatorio: false,
    estado: instalados === null ? 'aviso' : faltan.length ? 'aviso' : 'ok',
    detalle: instalados === null ? 'no pude leer ~/.claude/plugins/installed_plugins.json' : faltan.length ? `faltan: ${faltan.join(', ')}` : undefined,
    como: faltan.length ? faltan.map((p) => `/plugin install ${p}`).join(' · ') : 'Verificalos con /plugin.',
  });

  // 5b. Plugins que sobran en esta carpeta (PLG-CTX): los que no se usan acá. Los hermanos (otra derivación del mismo
  // ciclo, que comparte skills con este) y los requeridos nunca se proponen apagar.
  const higiene = instalados === null ? null : higienePlugins({ cwd, env, home, requeridos: PLUGINS_REQUERIDOS });
  if (higiene) {
    const { candidatos, sesiones, archivo, tokens } = higiene;
    sumar({
      id: 'higiene', titulo: 'Plugins que sobran en esta carpeta', obligatorio: false,
      estado: candidatos.length ? 'aviso' : 'ok',
      detalle: candidatos.length ? `${candidatos.length} plugin(s), ~${tokens} tokens por sesión` : undefined,
      como: candidatos.length
        ? [
            ...candidatos.map((c) => `- ${textoCandidato(c, sesiones)}`),
            `Para apagarlos sólo en esta carpeta y esta PC, que el usuario sume esto a ${archivo} (sin pisar otras claves; .claude/ no lo edita el agente):`,
            bloqueApagar(candidatos),
            'Después, reiniciá la sesión. Vale para toda cuenta de Claude que abra esta carpeta: si otra cuenta usa alguno de estos plugins acá, no lo apagues. Los plugins de la app de escritorio (los que no figuran en ~/.claude/settings.json) se administran desde la app.',
          ].join('\n')
        : undefined,
    });
  }

  // 6. Repo de un proyecto
  if (!repo) {
    sumar({
      id: 'repo', titulo: 'Sesión abierta en un repo de un proyecto', obligatorio: true, estado: 'falta',
      detalle: cwd,
      como: 'Abrí Claude Code en un repo de un proyecto registrado (proyectos/<id>/proyecto.yml del repo central). Si el proyecto es nuevo, dalo de alta con proyectos/_plantilla/.',
    });
    return pasos;
  }
  let proyecto = null;
  try {
    proyecto = cargarProyecto(repo.proyectoId, lin, repo.raiz, { home });
  } catch {
    // sin proyecto.yml
  }
  sumar({
    id: 'repo', titulo: 'Sesión abierta en un repo de un proyecto', obligatorio: true, estado: proyecto ? 'ok' : 'falta',
    detalle: `${nombreRepo(repo.raiz)} → proyecto ${repo.proyectoId}`,
    como: `Falta proyectos/${repo.proyectoId}/proyecto.yml en los lineamientos: actualizalos (git pull) o dalo de alta desde proyectos/_plantilla/.`,
  });
  if (!proyecto) return pasos;

  // 7. Repos del proyecto clonados juntos
  const propio = nombreRepo(repo.raiz).toLowerCase();
  const presentes = new Set([propio, ...reposHermanos(repo.raiz, repo.proyectoId, proyecto).map((r) => nombreRepo(r).toLowerCase())]);
  const ausentes = lista(proyecto.repos).map((r) => r?.nombre).filter((x) => typeof x === 'string' && !presentes.has(x.toLowerCase()));
  const cuenta = typeof proyecto.cuenta_github === 'string' ? proyecto.cuenta_github : '<cuenta>';
  sumar({
    id: 'repos', titulo: 'Repos del proyecto clonados uno junto al otro', obligatorio: false,
    estado: ausentes.length ? 'aviso' : 'ok', detalle: ausentes.length ? `faltan: ${ausentes.join(', ')}` : undefined,
    como: `En ${path.dirname(repo.raiz)}: ${ausentes.map((n) => `gh repo clone ${cuenta}/${n}`).join(' · ')} (sólo los que vayas a tocar).`,
  });

  // 8. Tests en esta PC
  const unit = typeof proyecto.tests?.unit === 'string' ? proyecto.tests.unit.trim() : '';
  const ejemplo = bloqueJson(repo.proyectoId, { unit: '<comando de tus tests> {archivos}', e2e: '<comando de tus E2E> {specs}', e2e_url: 'http://localhost:<puerto>' });
  sumar({
    id: 'tests', titulo: `Tests del proyecto ${repo.proyectoId} en esta PC`, obligatorio: true, estado: unit ? 'ok' : 'falta',
    detalle: unit ? (lista(proyecto.tests_locales).includes('unit') ? 'de ~/.claude/bacg-dev.json' : 'de proyecto.yml') : 'sin comando de tests',
    como: `Declará cómo corrés los tests en tu PC, en ~/.claude/bacg-dev.json (se suma a lo que ya tenga):\n${ejemplo}\n{archivos} = lo que está en stage; {specs} = los E2E del RQ.`,
  });

  // 9. El script de los tests existe
  if (unit) {
    const script = scriptDelComando(unit);
    const abs = script ? (path.isAbsolute(script) ? script : path.resolve(repo.raiz, script)) : null;
    const usaPlaceholder = script && /\{(raiz|repo:[^}]+)\}/.test(script);
    sumar({
      id: 'tests-script', titulo: 'El comando de tests encuentra su script', obligatorio: true,
      estado: !script || usaPlaceholder ? 'na' : fs.existsSync(abs) ? 'ok' : 'falta', detalle: script ?? 'sin script que verificar',
      como: `No existe ${abs}: corregí la ruta en ~/.claude/bacg-dev.json (proyectos.${repo.proyectoId}.tests.unit).`,
    });
  }

  // Skills oficiales de Odoo (PLG-ODOO): obligatorias en un proyecto Odoo cuyos repos tienen addons, porque la CLI
  // las exige al tocar un addon.
  if ([repo.raiz, ...reposHermanos(repo.raiz, repo.proyectoId, proyecto)].some((r) => usaOdoo(proyecto, r) && tieneAddons(r))) {
    const { faltan, origen } = estadoSkillsOdoo(home);
    const rama = ramaSkills(proyecto);
    sumar({
      id: 'odoo-skills', titulo: `Skills oficiales de Odoo (odoo/odoo ${rama})`, obligatorio: true,
      estado: faltan.length ? 'falta' : 'ok',
      detalle: faltan.length ? `faltan: ${faltan.join(', ')}` : origen?.commit ? `commit ${String(origen.commit).slice(0, 10)} del ${String(origen.fecha ?? '').slice(0, 10)}` : 'instaladas a mano',
      como: `Instalalas en ~/.claude/skills (se bajan con gh desde github.com/odoo/odoo/tree/${rama}/skills): \`node "${CLI}" odoo-skills\`. Después reiniciá la sesión de Claude Code.`,
    });
  }

  // 10. E2E (orienta: si el proyecto lo declara, publicar lo exige)
  const e2e = typeof proyecto.tests?.e2e === 'string' ? proyecto.tests.e2e.trim() : '';
  sumar({
    id: 'e2e', titulo: 'E2E en esta PC', obligatorio: false, estado: e2e ? 'ok' : 'aviso',
    detalle: e2e ? undefined : 'sin comando E2E: los RQ con UI no podrán registrar la verificación',
    como: `Sumá "e2e" y "e2e_url" en proyectos.${repo.proyectoId}.tests de ~/.claude/bacg-dev.json.`,
  });

  // 11. Ajustes locales presentes (orienta)
  sumar({
    id: 'local', titulo: 'Ajustes de esta PC (~/.claude/bacg-dev.json)', obligatorio: false,
    estado: ajustesLocales(repo.proyectoId, home) ? 'ok' : 'aviso',
    detalle: ajustesLocales(repo.proyectoId, home) ? undefined : `sin entrada para ${repo.proyectoId}`,
    como: 'Ver el paso de tests.',
  });
  return pasos;
}

/** ¿Falta algún paso obligatorio? Devuelve el primero o null. */
export const bloqueante = (pasos) => pasos.find((p) => p.obligatorio && p.estado === 'falta') ?? null;

const ICONO = { ok: '✅', falta: '❌', aviso: '⚠️', na: '·' };

/** Texto del stepper: lista numerada y el próximo paso con qué hacer. */
export function formatoAlta(pasos) {
  const listos = pasos.filter((p) => p.estado === 'ok' || p.estado === 'na').length;
  const lineas = [`Alta de lineamientos-dev-claude-bacg: ${listos}/${pasos.length} pasos listos`, ''];
  for (const p of pasos) {
    lineas.push(`${String(p.n).padStart(2)}. ${ICONO[p.estado]} ${p.titulo}${p.obligatorio ? '' : ' (recomendado)'}${p.detalle ? ` — ${p.detalle}` : ''}`);
  }
  const prox = bloqueante(pasos) ?? pasos.find((p) => p.estado === 'aviso');
  lineas.push('');
  if (!prox) lineas.push('Todo listo: ya podés abrir tu primer RQ con /bacg-rq <código>.');
  else {
    lineas.push(`${prox.estado === 'falta' ? 'Próximo paso (obligatorio)' : 'Recomendado'}: ${prox.n}. ${prox.titulo}`);
    lineas.push(prox.como ?? '');
    if (bloqueante(pasos)) lineas.push('', 'Hasta completar los pasos obligatorios no se abre un RQ. Volvé a correr /bacg-alta para ver el avance.');
  }
  return lineas.join('\n');
}

/** Una línea para el arranque de sesión, o null si no falta nada obligatorio. */
export function lineaAlta(pasos) {
  const b = bloqueante(pasos);
  if (!b) return null;
  const pendientes = pasos.filter((p) => p.obligatorio && p.estado === 'falta').length;
  return `Alta incompleta (${pendientes} paso(s) obligatorio(s); el próximo es "${b.titulo}"). Antes de abrir un RQ, guiá al usuario con /bacg-alta, de a un paso, hasta que quede todo en verde.`;
}
