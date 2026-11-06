// PLG-ODOO: skills oficiales de Odoo (odoo/odoo skills/, rama 20.0): instalación, alta y exigencia por etapa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SKILLS_ODOO, instalarSkillsOdoo, estadoSkillsOdoo, exigenciasOdoo, usaOdoo, dentroDeAddon, ramaSkills } from '../plugin/scripts/lib/odoo-skills.mjs';
import { faltaParaEtapa } from '../plugin/scripts/lib/requisitos.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// API de GitHub falsa: skills/<skill>/SKILL.md y una subcarpeta guidelines/ en odoo-guidelines.
function apiFalsa({ sinSkill = null } = {}) {
  const archivos = {};
  for (const s of SKILLS_ODOO) if (s !== sinSkill) archivos[`skills/${s}/SKILL.md`] = `---\nname: ${s}\n---\n`;
  archivos['skills/README.md'] = '# readme';
  archivos['skills/odoo-guidelines/guidelines/orm.md'] = '# orm';
  const llamadas = [];
  const api = (ruta) => {
    llamadas.push(ruta);
    if (ruta.startsWith('repos/odoo/odoo/commits/')) return { sha: 'abcdef1234567890' };
    const m = ruta.match(/^repos\/odoo\/odoo\/contents\/(.+)\?ref=(.+)$/);
    const rel = m[1];
    if (archivos[rel] !== undefined) return { content: Buffer.from(archivos[rel]).toString('base64'), encoding: 'base64' };
    const hijos = new Map();
    for (const k of Object.keys(archivos)) {
      if (!k.startsWith(`${rel}/`)) continue;
      const resto = k.slice(rel.length + 1).split('/');
      const p = `${rel}/${resto[0]}`;
      hijos.set(p, { path: p, type: resto.length > 1 ? 'dir' : 'file' });
    }
    return [...hijos.values()];
  };
  return { api, llamadas };
}

test('instalar: baja skills/ entera al commit de la rama, reemplaza sólo las de Odoo y registra el origen', () => {
  const home = tmp('home-odoo-');
  const dir = path.join(home, '.claude', 'skills');
  fs.mkdirSync(path.join(dir, 'odoo-review'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'odoo-review', 'viejo.md'), 'viejo');
  fs.mkdirSync(path.join(dir, 'mia'), { recursive: true });
  const { api, llamadas } = apiFalsa();
  const r = instalarSkillsOdoo({ home, api });
  assert.equal(r.commit, 'abcdef1234567890');
  assert.ok(llamadas.filter((l) => l.includes('/contents/')).every((l) => l.endsWith('?ref=abcdef1234567890')));
  for (const s of SKILLS_ODOO) assert.ok(fs.existsSync(path.join(dir, s, 'SKILL.md')), s);
  assert.ok(fs.existsSync(path.join(dir, 'odoo-guidelines', 'guidelines', 'orm.md')));
  assert.equal(fs.existsSync(path.join(dir, 'odoo-review', 'viejo.md')), false, 'reemplaza la carpeta entera');
  assert.ok(fs.existsSync(path.join(dir, 'mia')), 'no toca otras skills');
  const e = estadoSkillsOdoo(home);
  assert.deepEqual(e.faltan, []);
  assert.equal(e.origen.rama, '20.0');
});

test('instalar: si la rama no trae alguna skill, no toca nada', () => {
  const home = tmp('home-odoo-');
  const { api } = apiFalsa({ sinSkill: 'odoo-security' });
  assert.throws(() => instalarSkillsOdoo({ home, api, rama: '19.0' }), /no trae odoo-security/);
  assert.deepEqual(estadoSkillsOdoo(home).faltan, SKILLS_ODOO);
});

test('usaOdoo y ramaSkills: motor odoo por defecto, apagable, rama configurable', () => {
  assert.equal(usaOdoo({}), true);
  assert.equal(usaOdoo({ datos: { motor: 'supabase' } }), false);
  assert.equal(usaOdoo({ odoo_skills: false }), false);
  assert.equal(ramaSkills({}), '20.0');
  assert.equal(ramaSkills({ odoo_skills: { rama: '21.0' } }), '21.0');
});

function repoAddons() {
  const raiz = tmp('addons-');
  for (const rel of ['mod_a/__manifest__.py', 'grupo/mod_b/__manifest__.py']) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), '{}');
  }
  return raiz;
}

test('dentroDeAddon: ruta dentro del addon más cercano con __manifest__.py', () => {
  const raiz = repoAddons();
  assert.equal(dentroDeAddon(raiz, 'mod_a/models/x.py'), 'models/x.py');
  assert.equal(dentroDeAddon(raiz, 'grupo/mod_b/static/src/a.js'), 'static/src/a.js');
  assert.equal(dentroDeAddon(raiz, 'README.md'), null);
  assert.equal(dentroDeAddon(raiz, 'docs/x.md'), null);
});

test('exigenciasOdoo: guidelines o web por etapa 2, review en 3, security con rutas sensibles o controllers', () => {
  const raiz = repoAddons();
  const py = { sensible: { rutas: ['**/security/**'] } };
  const skills = (rutas) => exigenciasOdoo(py, raiz, rutas).map((x) => `${x.etapa}:${x.skill}`);
  assert.deepEqual(skills(['mod_a/models/x.py']), ['2:odoo-guidelines', '3:odoo-review']);
  assert.deepEqual(skills(['grupo/mod_b/static/src/a.js']), ['2:odoo-web-guidelines', '3:odoo-review']);
  assert.deepEqual(skills(['mod_a/security/ir.model.access.csv']), ['2:odoo-guidelines', '3:odoo-review', '3:odoo-security']);
  assert.deepEqual(skills(['mod_a/controllers/main.py']), ['2:odoo-guidelines', '3:odoo-review', '3:odoo-security']);
  assert.deepEqual(skills(['docs/x.md', 'n8n/wf.json']), [], 'fuera de un addon no exige');
  assert.deepEqual(skills(null), ['2:odoo-guidelines', '3:odoo-review'], 'sin saber qué toca, en un repo con addons: falla cerrada');
  assert.deepEqual(exigenciasOdoo(py, tmp('sin-addons-'), null), [], 'sin addons en el repo, nada');
  assert.deepEqual(exigenciasOdoo({ datos: { motor: 'supabase' } }, raiz, ['mod_a/models/x.py']), []);
});

test('faltaParaEtapa: suma las skills de Odoo del proyecto (y se cumplen con el nombre corto)', () => {
  const raiz = repoAddons();
  const estado = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', skills: [] };
  // Sin base ni upstream, rutasDelRq es null: falla cerrada en un repo con addons.
  let falta = faltaParaEtapa(estado, 3, raiz, {});
  assert.ok(falta.includes('odoo-guidelines'));
  assert.ok(falta.includes('odoo-review'));
  falta = faltaParaEtapa({ ...estado, skills: ['odoo-guidelines', 'odoo-review'] }, 3, raiz, {});
  assert.ok(!falta.includes('odoo-guidelines') && !falta.includes('odoo-review'));
  falta = faltaParaEtapa(estado, 3, raiz, { odoo_skills: false });
  assert.ok(!falta.includes('odoo-guidelines'));
});

test('faltaParaEtapa v4: odoo-guidelines se pide para el desarrollo (2) y odoo-review recién para la verificación (3)', () => {
  const raiz = repoAddons();
  const estado = { codigo: 'R-1', tipo: 'rq', clasificacion: 'bounded', skills: [] };
  const falta = faltaParaEtapa(estado, 2, raiz, {});
  assert.ok(falta.includes('odoo-guidelines'));
  assert.ok(!falta.includes('odoo-review'));
});
