import test from 'node:test';
import assert from 'node:assert/strict';
import { relativaAlRepo, globARegExp, tipoArchivo, reglasUi, skillsUi } from '../plugin/scripts/lib/rutas.mjs';

const RAIZ = String.raw`C:\MiCarpeta\N8N - BACG\x`;

test('relativaAlRepo: ruta Windows dentro del repo', () => {
  assert.equal(relativaAlRepo(RAIZ, String.raw`C:\MiCarpeta\N8N - BACG\x\src\a.ts`), 'src/a.ts');
});
test('relativaAlRepo: letra de unidad sin distinguir mayúsculas y raiz con barra final', () => {
  assert.equal(relativaAlRepo(RAIZ + String.fromCharCode(92), String.raw`c:\MiCarpeta\N8N - BACG\x\src\a.ts`), 'src/a.ts');
});
test('relativaAlRepo: rutas POSIX', () => {
  assert.equal(relativaAlRepo('/home/u/repo', '/home/u/repo/src/a.ts'), 'src/a.ts');
});
test('relativaAlRepo: la raíz misma da vacío', () => {
  assert.equal(relativaAlRepo(RAIZ, RAIZ), '');
});
test('relativaAlRepo: otro repo o prefijo parecido da null', () => {
  assert.equal(relativaAlRepo(RAIZ, String.raw`C:\MiCarpeta\N8N - BACG\otro\a.ts`), null);
  assert.equal(relativaAlRepo(RAIZ, String.raw`C:\MiCarpeta\N8N - BACG\xy\a.ts`), null);
  assert.equal(relativaAlRepo('/home/u/repo', '/home/u/otro/a.ts'), null);
});

test('globARegExp', () => {
  assert.ok(globARegExp('src/components/**').test('src/components/a/b.tsx'));
  assert.ok(globARegExp('**/*.css').test('index.css'));
  assert.ok(globARegExp('**/*.css').test('src/x/y.css'));
  assert.ok(!globARegExp('*.ts').test('src/a.ts'));
  assert.ok(globARegExp('*.ts').test('a.ts'));
  assert.ok(globARegExp('a?.ts').test('ab.ts'));
  assert.ok(!globARegExp('a?.ts').test('a/.ts'));
  assert.ok(!globARegExp('a.ts').test('axts'));
});

const proyecto = { ui: { patrones: ['src/pages/**', 'src/components/**', '**/*.css'] } };

test('tipoArchivo', () => {
  assert.equal(tipoArchivo('src/lib/x.ts', proyecto), 'producto');
  assert.equal(tipoArchivo('src/pages/P.tsx', proyecto), 'ui');
  assert.equal(tipoArchivo('src/lib/x.test.ts', proyecto), 'libre');
  assert.equal(tipoArchivo('src/pages/P.spec.tsx', proyecto), 'libre');
  assert.equal(tipoArchivo('docs/rq/R1/spec.md', proyecto), 'libre');
  assert.equal(tipoArchivo('e2e/a.spec.ts', proyecto), 'libre');
  assert.equal(tipoArchivo('tests/a.ts', proyecto), 'libre');
  assert.equal(tipoArchivo('README.md', proyecto), 'libre');
  assert.equal(tipoArchivo('.lineamientos', proyecto), 'libre');
  assert.equal(tipoArchivo('src/notas.md', proyecto), 'libre', 'todo .md es documentación');
  assert.equal(tipoArchivo('.lovable/memory/index.md', proyecto), 'libre');
  assert.equal(tipoArchivo('.agents/skills/x/SKILL.md', proyecto), 'libre');
  for (const p of ['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/x.mjs', '.claude/agents/x.json', '.claude/agents/x.md', '.claude/commands/x.md', '.claude/skills/x/SKILL.md']) {
    assert.equal(tipoArchivo(p, proyecto), 'producto', p);
  }
  assert.equal(tipoArchivo('supabase/migrations/1.sql', proyecto), 'producto');
  assert.equal(tipoArchivo('src/pages/P.tsx', {}), 'producto');
});

test('reglasUi y skillsUi: ui.reglas manda; ui.patrones con ui.skills como regla general', () => {
  const p = { ui: { patrones: ['src/components/**'], skills: ['canon'], reglas: [{ patrones: ['src/pages/Landing*.tsx'], skills: ['diseno'] }] } };
  assert.equal(tipoArchivo('src/pages/Landing.tsx', p), 'ui');
  assert.equal(tipoArchivo('src/pages/Otra.tsx', p), 'producto');
  assert.deepEqual(skillsUi('src/pages/Landing.tsx', p), ['diseno']);
  assert.deepEqual(skillsUi('src/components/B.tsx', p), ['canon']);
  assert.deepEqual(skillsUi('src/components/B.tsx', { ui: { patrones: ['src/components/**'] } }), []);
  assert.deepEqual(reglasUi({}), []);
});

test('tipoArchivo: .como-trabajo/ nunca es libre, tampoco sus .md', () => {
  assert.equal(tipoArchivo('.como-trabajo/proyecto.yml', null), 'producto');
  assert.equal(tipoArchivo('.como-trabajo/reglas.md', null), 'producto');
});
