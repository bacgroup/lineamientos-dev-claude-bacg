import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  operacionesGit,
  evaluarBash,
  arbolEnStage,
  archivosEnStage,
} from '../plugin/scripts/lib/compuerta-bash.mjs';
import { guardarEstado } from '../plugin/scripts/lib/estado.mjs';
import { cli } from '../plugin/scripts/lib/cli.mjs';
import { arbolTesteado } from '../plugin/scripts/lib/arbol.mjs';
import { crearRepoTemporal } from './helpers.mjs';

const DIR_LIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lineamientos');
const CWD = path.resolve(os.tmpdir(), 'base');
const FRASE_PROD = 'Publicá demo-app a producción';
const MSG_TESTS = `Corré los tests sobre lo que está en stage: ${cli()} registrar-tests`;

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function activar(raiz, estado) {
  if (estado) guardarEstado(raiz, estado);
  fs.mkdirSync(path.join(raiz, 'docs', 'rq'), { recursive: true });
  // Etapa 2 v4: un Acotado necesita ## Tareas en spec.md y un Arquitectónico, plan.md (los fixtures los registran).
  const cod = estado?.codigo ?? 'R-B1';
  const dirRq = path.join(raiz, 'docs', 'rq', cod);
  if (estado?.clasificacion === 'bounded' && !fs.existsSync(path.join(dirRq, 'spec.md'))) {
    fs.mkdirSync(dirRq, { recursive: true });
    fs.writeFileSync(path.join(dirRq, 'spec.md'), '# spec\n\n## Tareas\n\n- [ ] una\n');
  }
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), `${estado?.codigo ?? 'R-B1'}\n`);
}

const base = (extra = {}) => ({
  codigo: 'R-B1', tipo: 'rq', clasificacion: 'bounded', etapa: 5,
  autonomia: null, aprobaciones: [], saltos: [], circuito: [], ...extra,
});
const SKILLS_PROD = ['superpowers:brainstorming', 'superpowers:test-driven-development', { skill: 'superpowers:verification-before-completion', etapa: 3 }];
const verde = { tests: { ok: true, arbol: 'x' }, revision: { ok: true }, skills: SKILLS_PROD };
const okProd = { etapa: 5, frase: FRASE_PROD, fecha: '2026-10-23T12:00:00Z' };
const paso = (p) => ({ paso: p, fecha: '2026-10-23T12:00:00Z' });

const evaluar = (comando, cwd, textosUsuario = []) =>
  evaluarBash({ comando, cwd, ctx: { textosUsuario }, dirLin: DIR_LIN });

// ---------- operacionesGit ----------

test('operacionesGit: add && commit -> un commit en el cwd, marcado previo', () => {
  assert.deepEqual(operacionesGit('git add . && git commit -m "x"', CWD), [
    { op: 'commit', dir: CWD, todos: false, previo: true },
  ]);
  assert.equal(operacionesGit('git status && git commit -m x', CWD)[0].previo, undefined);
});

test('operacionesGit: palabras clave, envoltorios y comillas de bash', () => {
  const push = [{ op: 'push', dir: CWD }];
  for (const cmd of [
    'gi\\t push',
    "$'git' push",
    "$'\\x67it' push",
    '$"git" push',
    '{ git push; }',
    'if true; then git push; fi',
    'while false; do git push; done',
    '! git push',
    'sudo git push',
    'sudo -u root git push',
    'timeout 60 git push',
    'timeout -s KILL 60 git push',
    'nice -n 5 git push',
    'stdbuf -oL git push',
    'env -u FOO git push',
    'env -i FOO=1 git push',
    'echo x | xargs -n 1 git push',
    'command git push',
    'exec git push',
    'nohup git push',
    'time git push',
    'git push>salida.txt 2>&1',
    'eval "git push"',
  ]) {
    assert.deepEqual(operacionesGit(cmd, CWD), push, cmd);
  }
  // subtree publica algo distinto de la rama actual: queda marcado como amplio.
  assert.deepEqual(operacionesGit('git subtree push --prefix=a origin main', CWD), [{ op: 'push', dir: CWD, amplio: true }]);
  assert.deepEqual(operacionesGit('env -C sub git push', CWD), [{ op: 'push', dir: path.resolve(CWD, 'sub') }]);
  assert.deepEqual(operacionesGit('sudo -D sub git push', CWD), [{ op: 'push', dir: path.resolve(CWD, 'sub') }]);
});

test('operacionesGit: red de seguridad (falla cerrada)', () => {
  assert.deepEqual(operacionesGit('G=git; $G push', CWD), [{ op: 'push', dir: CWD, red: true }]);
  assert.deepEqual(operacionesGit('X=gh; $X pr merge 3', CWD), [{ op: 'merge-pr', dir: CWD, red: true }]);
  // argumentos entre comillas no disparan la red
  assert.deepEqual(operacionesGit('git commit -m "arreglo git push"', CWD), [
    { op: 'commit', dir: CWD, todos: false },
  ]);
});

test('C1/I2: la red no cuenta menciones dentro de git <subcomando> ni gh <subcomando> resueltos', () => {
  for (const cmd of [
    'git stash push -m wip',
    'git add src/push.ts',
    'git checkout -b feature/push-notifications',
    'git log --oneline | grep push',
    'gh pr checks 12 && echo listo para merge',
  ]) {
    assert.deepEqual(operacionesGit(cmd, CWD).filter((o) => o.op !== 'commit'), [], cmd);
  }
  // el comando sin resolver ($G) sigue disparando la red, marcada como tal
  assert.deepEqual(operacionesGit('G=git; $G push', CWD), [{ op: 'push', dir: CWD, red: true }]);
  // las ops del parser no llevan la marca
  assert.equal(operacionesGit('git push', CWD)[0].red, undefined);
});

test('T7: |& es un pipe (reenvía stdin al shell)', () => {
  const ops = operacionesGit('echo "cd ../prod && git push" |& bash', CWD);
  assert.ok(
    ops.some((o) => o.op === 'push' && o.dir === path.resolve(CWD, '../prod') && !o.red),
    JSON.stringify(ops),
  );
});

test('operacionesGit: texto que entra a un shell por heredoc, here-string o pipe se analiza', () => {
  const push = [{ op: 'push', dir: CWD }];
  assert.deepEqual(operacionesGit('bash <<EOF\ngit push\nEOF', CWD), push);
  assert.deepEqual(operacionesGit("sh <<'FIN'\ncd sub && git push\nFIN", CWD), [
    { op: 'push', dir: path.resolve(CWD, 'sub') },
    { op: 'push', dir: CWD, red: true }, // red del shell: la carpeta del shell también
  ]);
  assert.deepEqual(operacionesGit("bash <<< 'git push'", CWD), push);
  assert.deepEqual(operacionesGit('echo "git push" | bash', CWD), push);
  assert.deepEqual(operacionesGit('echo "gh pr merge 3" | sh', CWD), [{ op: 'merge-pr', dir: CWD, pr: '3' }]);
  // red del shell: texto que el parser no reconstruye igual cuenta
  assert.deepEqual(operacionesGit("printf 'git %s' push | xargs bash -s", CWD), [{ op: 'push', dir: CWD, red: true }]);
  assert.deepEqual(operacionesGit('echo "git push"', CWD), []);
  assert.deepEqual(operacionesGit('cat <<EOF | tee x\ngit push\nEOF', CWD), []);
});

test('operacionesGit: red por carpeta', () => {
  assert.deepEqual(operacionesGit('git push; cd ../otro && G=git; $G push', CWD), [
    { op: 'push', dir: CWD },
    { op: 'push', dir: path.resolve(CWD, '../otro'), red: true },
  ]);
  // las ops que vienen del stdin de un shell no tapan una mención sin comillas en otra carpeta
  assert.deepEqual(operacionesGit('echo "git push" | bash; cd ../prod && G=git; $G push', CWD), [
    { op: 'push', dir: CWD },
    { op: 'push', dir: path.resolve(CWD, '../prod'), red: true },
  ]);
  // el heredoc del productor también pasa por el pipe al shell
  assert.deepEqual(operacionesGit('cat <<EOF | bash\ncd ../prod && git push\nEOF', CWD), [
    { op: 'push', dir: path.resolve(CWD, '../prod') },
    { op: 'push', dir: CWD, red: true },
  ]);
  // el stdin se reenvía por todas las etapas del pipe, no sólo por la primera
  const ordenar = (ops) => [...ops].sort((a, b) => a.dir.localeCompare(b.dir));
  const prodYCwd = ordenar([
    { op: 'push', dir: path.resolve(CWD, '../prod') },
    { op: 'push', dir: CWD, red: true },
  ]);
  assert.deepEqual(ordenar(operacionesGit('cat <<EOF | tee log | bash\ncd ../prod && git push\nEOF', CWD)), prodYCwd);
  assert.deepEqual(ordenar(operacionesGit('echo "cd ../prod && git push" | cat | bash', CWD)), prodYCwd);
  // sin menciones de más, no se inventan pushes en otras carpetas
  assert.deepEqual(operacionesGit('cd ../otro && git push', CWD), [{ op: 'push', dir: path.resolve(CWD, '../otro') }]);
});

test('operacionesGit: flags globales de gh y URL sin esquema', () => {
  // pr: el número, la URL o la rama del PR, para leer su rama base (ramas_prod).
  const m = [{ op: 'merge-pr', dir: CWD, repoGh: 'o/n', pr: '3' }];
  assert.deepEqual(operacionesGit('gh -R o/n pr merge 3', CWD), m);
  assert.deepEqual(operacionesGit('gh --repo o/n pr merge 3', CWD), m);
  assert.deepEqual(operacionesGit('gh --repo=o/n pr merge 3', CWD), m);
  assert.deepEqual(operacionesGit('GH_REPO=o/n gh pr merge 3', CWD), m);
  assert.deepEqual(operacionesGit('gh pr merge github.com/o/n/pull/3', CWD), [{ ...m[0], pr: 'github.com/o/n/pull/3' }]);
  assert.deepEqual(operacionesGit('gh pr merge www.github.com/o/n/pull/3 --squash', CWD), [{ ...m[0], pr: 'www.github.com/o/n/pull/3' }]);
  assert.deepEqual(operacionesGit('gh -R o/n pr view 3', CWD), []);
});

test('operacionesGit: el cuerpo de un heredoc no es un comando', () => {
  assert.deepEqual(operacionesGit("cat > a.sh <<'EOF'\ngit push\nEOF\ngit status", CWD), []);
  assert.deepEqual(operacionesGit('cat <<-FIN\n\tgit push\n\tFIN\ngit push', CWD), [{ op: 'push', dir: CWD }]);
});

test('operacionesGit: gh pr merge con URL del PR', () => {
  assert.deepEqual(operacionesGit('gh pr merge https://github.com/nkick25/demo-app/pull/12 --squash', CWD), [
    { op: 'merge-pr', dir: CWD, repoGh: 'nkick25/demo-app', pr: 'https://github.com/nkick25/demo-app/pull/12' },
  ]);
  assert.deepEqual(operacionesGit('GH_REPO=nkick25/x gh pr merge 3', CWD), [
    { op: 'merge-pr', dir: CWD, repoGh: 'nkick25/x', pr: '3' },
  ]);
});

test('operacionesGit: cd relativo antes del push', () => {
  const ops = operacionesGit('cd ../otro && git push', CWD);
  assert.deepEqual(ops, [{ op: 'push', dir: path.resolve(CWD, '../otro') }]);
});

test('operacionesGit: git -C con ruta entre comillas y espacios', () => {
  const ops = operacionesGit('git -C "C:/a b/repo" push origin main', CWD);
  assert.deepEqual(ops, [{ op: 'push', dir: path.resolve(CWD, 'C:/a b/repo'), refspecs: ['main'] }]);
});

test('operacionesGit: variables de entorno y --no-pager', () => {
  assert.deepEqual(operacionesGit('FOO=1 git --no-pager push', CWD), [{ op: 'push', dir: CWD }]);
});

test('operacionesGit: commit -am -> todos', () => {
  assert.deepEqual(operacionesGit('git commit -am "x"', CWD), [{ op: 'commit', dir: CWD, todos: true }]);
  assert.equal(operacionesGit('git commit --all -m x', CWD)[0].todos, true);
  assert.equal(operacionesGit('git commit -a -m x', CWD)[0].todos, true);
  // -ma: el mensaje es "a", no es --all
  assert.equal(operacionesGit('git commit -ma', CWD)[0].todos, false);
  assert.equal(operacionesGit('git commit -m "-a"', CWD)[0].todos, false);
});

test('operacionesGit: texto entre comillas no es un comando', () => {
  assert.deepEqual(operacionesGit('echo "git push"', CWD), []);
  assert.deepEqual(operacionesGit("echo 'a && git push'", CWD), []);
});

test('operacionesGit: gh pr merge con y sin --repo', () => {
  assert.deepEqual(operacionesGit('gh pr merge 12 --merge', CWD), [{ op: 'merge-pr', dir: CWD, pr: '12' }]);
  assert.deepEqual(operacionesGit('gh pr merge 12 --merge --repo nkick25/demo-app', CWD), [
    { op: 'merge-pr', dir: CWD, repoGh: 'nkick25/demo-app', pr: '12' },
  ]);
  assert.equal(operacionesGit('gh pr merge 12 -R nkick25/x', CWD)[0].repoGh, 'nkick25/x');
});

test('operacionesGit: git status y otros -> []', () => {
  assert.deepEqual(operacionesGit('git status', CWD), []);
  assert.deepEqual(operacionesGit('git log --oneline | head', CWD), []);
  assert.deepEqual(operacionesGit('', CWD), []);
});

test('operacionesGit: separadores ; || | y saltos de línea, -C repetido', () => {
  const ops = operacionesGit('git status; git commit -m a || true\ngit -C x -C y push | cat', CWD);
  assert.deepEqual(ops, [
    { op: 'commit', dir: CWD, todos: false },
    { op: 'push', dir: path.resolve(CWD, 'x', 'y') },
  ]);
});

test('operacionesGit: subshell no filtra el cd', () => {
  const ops = operacionesGit('(cd sub && git commit -m a) && git push', CWD);
  assert.deepEqual(ops, [
    { op: 'commit', dir: path.resolve(CWD, 'sub'), todos: false },
    { op: 'push', dir: CWD },
  ]);
});

test('operacionesGit: bash -c "..." se analiza adentro', () => {
  assert.deepEqual(operacionesGit('bash -c "cd sub && git push"', CWD), [
    { op: 'push', dir: path.resolve(CWD, 'sub') },
  ]);
});

test('operacionesGit: sustitución de comandos se analiza (comillas dobles, $( ) y backticks)', () => {
  assert.deepEqual(operacionesGit('echo "$(git push)"', CWD), [{ op: 'push', dir: CWD }]);
  assert.deepEqual(operacionesGit('echo `git push`', CWD), [{ op: 'push', dir: CWD }]);
  assert.deepEqual(operacionesGit('x=$(git push)', CWD), [{ op: 'push', dir: CWD }]);
  assert.deepEqual(operacionesGit("echo '$(git push)'", CWD), []);
});

test('operacionesGit: commit con rutas -> rutas: true', () => {
  const [op] = operacionesGit('git commit -m x src/a.ts', CWD);
  assert.equal(op.rutas, true);
});

// ---------- arbolEnStage / archivosEnStage ----------

test('arbolEnStage y archivosEnStage', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo' });
  assert.deepEqual(archivosEnStage(raiz), []);
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a b.ts'), 'x');
  git(raiz, 'add', '.');
  assert.deepEqual(archivosEnStage(raiz), ['src/a b.ts']);
  assert.match(arbolEnStage(raiz), /^[0-9a-f]{40}$/);
});

// ---------- commit ----------

test('sin git ops -> allow, no crítica', () => {
  assert.deepEqual(evaluar('ls -la', CWD), { decision: 'allow', critica: false });
});

test('repo sin .bacg-lineamientos -> allow', () => {
  const raiz = crearRepoTemporal({});
  fs.writeFileSync(path.join(raiz, 'a.ts'), 'x');
  git(raiz, 'add', '.');
  assert.deepEqual(evaluar('git commit -m x', raiz), { decision: 'allow', critica: false });
  assert.deepEqual(evaluar('git push', raiz), { decision: 'allow', critica: false });
});

test('commit sólo de docs sin estado -> allow', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  fs.mkdirSync(path.join(raiz, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'nota.md'), 'x');
  git(raiz, 'add', '.');
  assert.deepEqual(evaluar('git commit -m docs', raiz), { decision: 'allow', critica: false });
});

test('commit -a -> deny', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const r = evaluar('git commit -am "x"', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(
    r.motivo,
    `git commit -a no deja verificar los tests: hacé git add explícito y corré ${cli()} registrar-tests`,
  );
});

test('los motivos de deny nombran $RQ, no la ruta completa (la da SessionStart)', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const motivo = evaluar('git commit -am "x"', raiz).motivo;
  assert.match(motivo, /\$RQ registrar-tests/);
  assert.doesNotMatch(motivo, /rq\.mjs"/);
  assert.doesNotMatch(evaluar('git push', raiz).motivo, /CLAUDE_PLUGIN_ROOT/);
});

test('commit de código sin RQ activo -> deny', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  fs.writeFileSync(path.join(raiz, 'a.ts'), 'x');
  git(raiz, 'add', '.');
  const r = evaluar('git commit -m x', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, `No hay RQ activo en ${raiz}: abrilo con ${cli()} abrir antes de commitear código.`);
});

test('commit de src/a.ts: árbol distinto -> deny; árbol igual -> allow', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'uno');
  git(raiz, 'add', '.');
  activar(raiz, base({ tests: { ok: true, arbol: '0'.repeat(40) } }));
  let r = evaluar('git commit -m x', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, MSG_TESTS);

  activar(raiz, base({ tests: { ok: true, arbol: arbolEnStage(raiz) } }));
  assert.deepEqual(evaluar('git commit -m x', raiz), { decision: 'allow', critica: false });

  activar(raiz, base({ tests: { ok: false, arbol: arbolEnStage(raiz) } }));
  assert.equal(evaluar('git commit -m x', raiz).decision, 'deny');
});

test('commit con salto de commit válido -> allow', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  fs.writeFileSync(path.join(raiz, 'a.ts'), 'x');
  git(raiz, 'add', '.');
  const frase = 'Commiteá sin tests esta vez';
  activar(raiz, base({ saltos: [{ compuerta: 'commit', frase, motivo: 'm', fecha: 'f' }] }));
  assert.deepEqual(evaluar('git commit -m x', raiz, [frase]), { decision: 'allow', critica: false });
});

// ---------- push / merge ----------

test('C1: subcomandos que mencionan push/merge sin publicar -> allow sin RQ', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  for (const cmd of [
    'git stash push -m wip',
    'git checkout -b feature/push-notifications',
    'git log --oneline | grep push',
    'gh pr checks 12 && echo listo para merge',
  ]) {
    assert.deepEqual(evaluar(cmd, raiz), { decision: 'allow', critica: false }, cmd);
  }
  assert.equal(evaluar('G=git; $G push', raiz).decision, 'deny');
});

test('push a push_prod sin OK de etapa 5 -> deny, crítica', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ ...verde, circuito: [paso('sql:refprod1')] }));
  const r = evaluar('git push origin main', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Publicar demo-app es PROD: falta el OK del usuario para PROD (etapa 5) en el RQ R-B1.');
});

test('push sin etapa 3 -> deny', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ tests: { ok: true }, aprobaciones: [okProd] }));
  const r = evaluar('git push', raiz, [FRASE_PROD]);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, 'Falta la etapa 3 (tests en verde y revisión sin bloqueantes) del RQ R-B1.');
  assert.equal(r.critica, true);
});

test('push sin RQ activo -> deny, crítica', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const r = evaluar('git push', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.match(r.motivo, /^No hay RQ activo en /);
});

test('push con OK pero sin sql:refprod1 -> deny nombrando el paso', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd] }));
  const r = evaluar('git push', raiz, [FRASE_PROD]);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Circuito de PROD: falta el paso sql:refprod1 antes de push:demo-app.');
});

test('push completo -> allow, crítica', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd], circuito: [paso('sql:refprod1')] }));
  assert.deepEqual(evaluar('git push', raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
});

test('OK de PROD: se vuelve a comprobar contra la sesión al publicar (registrado por fuera no alcanza)', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd], circuito: [paso('sql:refprod1')] }));
  assert.equal(evaluar('git push', raiz, []).decision, 'deny');
  assert.deepEqual(evaluar('git push', raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
});

test('rq.mjs con aprobar|autonomia|saltar que el parser no puede leer -> deny (red de seguridad)', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  for (const cmd of [
    'node -e "import(\'/x/rq.mjs\').then((m) => m.main([\'aprobar\', \'5\', \'OK PROD\']))"',
    'node ./otro.mjs /x/rq.mjs aprobar 5 x',
  ]) {
    const r = evaluar(cmd, raiz, ['OK PROD']);
    assert.equal(r.decision, 'deny', cmd);
    assert.match(r.motivo, /en una forma que la compuerta no puede leer/, cmd);
  }
  assert.deepEqual(evaluar('grep -n aprobar plugin/scripts/rq.mjs', crearRepoTemporal({})), { decision: 'allow', critica: false }, 'fuera de un repo registrado');
});

test('salto "push" en sesión saltea la etapa 3 pero nunca la 5 ni el circuito en PROD', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const frase = 'Pusheá igual, me hago cargo';
  const salto = { compuerta: 'push', frase, motivo: 'm', fecha: 'f' };
  activar(raiz, base({ saltos: [salto] }));
  let r = evaluar('git push', raiz, [frase]);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Publicar demo-app es PROD: falta el OK del usuario para PROD (etapa 5) en el RQ R-B1.');

  activar(raiz, base({ saltos: [salto], aprobaciones: [okProd] }));
  r = evaluar('git push', raiz, [frase, FRASE_PROD]);
  assert.equal(r.motivo, 'Circuito de PROD: falta el paso sql:refprod1 antes de push:demo-app.');

  activar(raiz, base({ saltos: [salto], aprobaciones: [okProd], circuito: [paso('sql:refprod1')] }));
  assert.deepEqual(evaluar('git push', raiz, [frase, FRASE_PROD]), { decision: 'allow', critica: true });
});

test('salto "push" registrado: saltea la etapa 3 en cualquier sesión, nunca la 5', () => {
  const salto = { compuerta: 'push', frase: 'x', motivo: 'm', fecha: 'f' };
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ saltos: [salto] }));
  let r = evaluar('git push', raiz, []);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.match(r.motivo, /etapa 5/);

  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'dev'), { recursive: true });
  fs.writeFileSync(
    path.join(dirLin, 'proyectos', 'dev', 'proyecto.yml'),
    'id: dev\nrepos:\n  - { nombre: dev-app, rol: padre, push_prod: false }\n',
  );
  const dev = crearRepoTemporal({ proyectoId: 'dev', nombre: 'dev-app' });
  activar(dev, base());
  r = evaluarBash({ comando: 'git push', cwd: dev, ctx: { textosUsuario: [] }, dirLin });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, false);
  assert.match(r.motivo, /^Falta la etapa 3/);
  activar(dev, base({ saltos: [salto] }));
  r = evaluarBash({ comando: 'git push', cwd: dev, ctx: { textosUsuario: [] }, dirLin });
  assert.deepEqual(r, { decision: 'allow', critica: false });
});

test('gh pr merge con destino explícito desde un directorio no registrado -> deny crítico', () => {
  const suelto = crearRepoTemporal({});
  const motivo =
    'Merge de nkick25/demo-app fuera de un repo registrado: corré el merge desde el repo del proyecto para que la compuerta pueda verificar el RQ.';
  for (const cmd of [
    'gh pr merge 12 --merge --repo nkick25/demo-app',
    'gh pr merge https://github.com/nkick25/demo-app/pull/12 --merge',
  ]) {
    assert.deepEqual(evaluar(cmd, suelto), { decision: 'deny', motivo, critica: true }, cmd);
  }
  // sin destino explícito, un directorio no registrado sigue permitido
  assert.deepEqual(evaluar('gh pr merge 12', suelto), { decision: 'allow', critica: false });
});

test('gh pr merge con URL desde un repo registrado resuelve el destino en el proyecto', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'otro-nombre' });
  activar(raiz, base({ ...verde }));
  const r = evaluar('gh pr merge https://github.com/nkick25/demo-app/pull/12', raiz, []);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Publicar demo-app es PROD: falta el OK del usuario para PROD (etapa 5) en el RQ R-B1.');
  const r2 = evaluar('gh pr merge https://github.com/nkick25/desconocido/pull/12', raiz, []);
  assert.equal(r2.motivo, 'Publicar desconocido es PROD: falta el OK del usuario para PROD (etapa 5) en el RQ R-B1.');
});

test('git add <código> && git commit en el mismo comando -> deny; con sólo docs o tests -> allow', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  const r = evaluar('git add src/a.ts && git commit -m x', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(
    r.motivo,
    `git add && git commit en un comando sólo vale para docs y tests, y src/a.ts no lo es. Con código: ${cli()} commit "<mensaje>" <rutas>.`,
  );
  // Una carpeta de docs se expande: vale si todo lo que agrega es libre (E4).
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', 'X'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'X', 'spec.md'), 'x');
  git(raiz, 'reset', '-q');
  assert.equal(evaluar('git add docs/rq/X && git commit -m x', raiz).decision, 'allow', 'carpeta de docs');
  fs.mkdirSync(path.join(raiz, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'n.md'), 'x');
  assert.deepEqual(evaluar('git add docs/n.md CHANGELOG.md && git commit -m x', raiz), { decision: 'allow', critica: false });
  assert.equal(evaluar('git add -A && git commit -m x', raiz).decision, 'deny', 'add amplio');
  assert.equal(evaluar('git add docs && git add src/a.ts && git commit -m x', raiz).decision, 'deny');
  // Con código ya en stage, un add de docs en el mismo comando no alcanza.
  git(raiz, 'add', 'src/a.ts');
  assert.equal(evaluar('git add docs/n.md && git commit -m x', raiz).decision, 'deny');
});

test('git add de docs con estado.yml y ACTIVO && git commit (cierre a mano) -> allow; con código, deny', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  for (const f of ['docs/backlog.md', 'docs/log/rq.jsonl', 'docs/rq/R-1/estado.yml', 'docs/rq/ACTIVO', 'src/a.ts']) {
    fs.mkdirSync(path.dirname(path.join(raiz, f)), { recursive: true });
    fs.writeFileSync(path.join(raiz, f), 'x');
  }
  const cmd = 'git add docs/backlog.md docs/log/rq.jsonl docs/rq/R-1/estado.yml docs/rq/ACTIVO && git commit -m "docs(R-1): cierre"';
  assert.deepEqual(evaluar(cmd, raiz), { decision: 'allow', critica: false });
  assert.equal(evaluar('git add docs/rq/R-1/estado.yml src/a.ts && git commit -m x', raiz).decision, 'deny');
});

test('error inesperado al evaluar -> deny con la crítica ya calculada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sin git '));
  fs.writeFileSync(path.join(dir, '.bacg-lineamientos'), 'proyecto: demo\n');
  // .git roto: git falla aunque algún directorio padre sea un repo.
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ./no-existe\n');
  const r = evaluar('git commit -m x; git push', dir);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.match(r.motivo, /^No se pudo evaluar commit \(.+\)$/);
});

test('repo con .bacg-lineamientos que no figura en proyecto.repos -> push_prod (falla cerrada)', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'otro-nombre' });
  activar(raiz, base({ ...verde }));
  const r = evaluar('git push', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Publicar otro-nombre es PROD: falta el OK del usuario para PROD (etapa 5) en el RQ R-B1.');
  // con OK: el paso push:otro-nombre no está en circuito_prod -> sólo exige la etapa 5
  activar(raiz, base({ ...verde, aprobaciones: [okProd] }));
  assert.deepEqual(evaluar('git push', raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
});

test('nombre del repo sin distinguir mayúsculas', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'Demo-App' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd] }));
  const r = evaluar('git push', raiz, [FRASE_PROD]);
  assert.equal(r.motivo, 'Circuito de PROD: falta el paso sql:refprod1 antes de push:demo-app.');
});

test('push a repo sin push_prod con etapa 3 -> allow, no crítica', () => {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'dev'), { recursive: true });
  fs.writeFileSync(
    path.join(dirLin, 'proyectos', 'dev', 'proyecto.yml'),
    'id: dev\nrepos:\n  - { nombre: dev-app, rol: padre, push_prod: false }\n',
  );
  const raiz = crearRepoTemporal({ proyectoId: 'dev', nombre: 'dev-app' });
  activar(raiz, base({ ...verde }));
  assert.deepEqual(evaluarBash({ comando: 'git push', cwd: raiz, ctx: { textosUsuario: [] }, dirLin }), {
    decision: 'allow',
    critica: false,
  });
  activar(raiz, base({ tests: { ok: true } }));
  const r = evaluarBash({ comando: 'git push', cwd: raiz, ctx: { textosUsuario: [] }, dirLin });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, false);
});

test('gh pr merge --repo a demo-app desde otro repo del proyecto -> merge-prs-sync', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'otro-nombre' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd] }));
  const cmd = 'gh pr merge 12 --merge --repo nkick25/demo-app';
  // merge-prs-sync:demo-app no está en circuito_prod -> sólo etapa 5
  assert.deepEqual(evaluar(cmd, raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
  const r = evaluar(cmd, raiz, []);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, 'Publicar demo-app es PROD: falta el OK del usuario para PROD (etapa 5) en el RQ R-B1.');
});

test('varias operaciones: gana el primer deny; crítica si alguna es push_prod', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const r = evaluar('git commit -am x && git push', raiz);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^git commit -a/);
  assert.equal(r.critica, true);
});

test('cd hacia el repo antes del push se sigue', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd], circuito: [paso('sql:refprod1')] }));
  assert.deepEqual(evaluar(`cd "${raiz}" && git push`, os.tmpdir(), [FRASE_PROD]), { decision: 'allow', critica: true });
  activar(raiz, base({ ...verde, circuito: [paso('sql:refprod1')] }));
  const r = evaluar(`cd "${raiz}" && git push`, os.tmpdir(), [FRASE_PROD]);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
});

// ---------- Frases de aprobación: se validan al registrarlas ----------

test('rq.mjs aprobar|autonomia|saltar: la frase tiene que ser texto literal del usuario en la sesión', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const cmds = [
    'node "$RQ" aprobar 5 "OK PROD sedes"',
    'node "C:/x/rq.mjs" aprobar 5 "OK PROD sedes" --rq R-1',
    'RQ=/x/rq.mjs; node "$RQ" --rq R-1 autonomia 4 "OK PROD sedes"',
    'node /x/rq.mjs saltar push "OK PROD sedes" "tests rojos ajenos"',
  ];
  for (const cmd of cmds) {
    const r = evaluar(cmd, raiz, ['otra cosa']);
    assert.equal(r.decision, 'deny', cmd);
    assert.match(r.motivo, /tiene que ser texto literal del usuario/, cmd);
    assert.deepEqual(evaluar(cmd, raiz, ['Dale, OK PROD sedes.']), { decision: 'allow', critica: false }, cmd);
  }
  // Un "Dale" vale si fue el mensaje entero, también para PROD.
  assert.deepEqual(evaluar('node "$RQ" aprobar 5 "Dale"', raiz, ['Dale']), { decision: 'allow', critica: false });
  assert.equal(evaluar('node "$RQ" aprobar 5 "Dale"', raiz, ['Dale, pero mañana']).decision, 'deny');
  // Otros subcomandos y otros scripts no se miran.
  assert.deepEqual(evaluar('node "$RQ" etapa 2', raiz, []), { decision: 'allow', critica: false });
  assert.deepEqual(evaluar('node build.mjs aprobar 1 x', raiz, []), { decision: 'allow', critica: false });
});

// ---------- Push de docs, varios RQ y circuito por dependencias ----------

function repoConRemoto(nombre = 'demo-app') {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre });
  // El nombre del repo sale del remoto origin: el remoto se llama como el repo.
  const remoto = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remoto-')), `${nombre}.git`);
  fs.mkdirSync(remoto);
  git(remoto, 'init', '-q', '--bare');
  git(raiz, 'remote', 'add', 'origin', remoto);
  git(raiz, 'push', '-q', '-u', 'origin', 'HEAD');
  return raiz;
}

test('push que sólo publica docs o tests -> allow sin RQ; con código, la compuerta de siempre', () => {
  const raiz = repoConRemoto();
  fs.mkdirSync(path.join(raiz, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'n.md'), 'x');
  fs.writeFileSync(path.join(raiz, 'NOTAS.md'), 'x');
  git(raiz, 'add', '.');
  git(raiz, 'commit', '-q', '-m', 'docs');
  assert.deepEqual(evaluar('git push', raiz, []), { decision: 'allow', critica: true });
  assert.equal(evaluar('git push origin otra:main', raiz, []).decision, 'deny', 'refspec de otra rama');
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  git(raiz, 'add', '.');
  git(raiz, 'commit', '-q', '-m', 'código');
  const r = evaluar('git push', raiz, []);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^No hay RQ activo/);
});

test('varios RQ activos: publica si alguno cumple', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  guardarEstado(raiz, base({ codigo: 'R-B2' }));
  activar(raiz, base({ ...verde, aprobaciones: [okProd], circuito: [paso('sql:refprod1')] }));
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-B1\nR-B2\n');
  assert.deepEqual(evaluar('git push', raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'ACTIVO'), 'R-B2\n');
  assert.equal(evaluar('git push', raiz, [FRASE_PROD]).decision, 'deny');
});

test('circuito: sql:<ref> no corresponde si el RQ no trae migraciones; despues_de y estado real deciden el orden', () => {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dirLin, 'proyectos', 'demo', 'proyecto.yml'), [
    'id: demo',
    'repos:',
    '  - { nombre: demo-app, rol: padre }',
    '  - { nombre: sede, rol: sede }',
    'circuito_prod:',
    '  - { paso: "sql:refprod1" }',
    '  - { paso: "push:demo-app" }',
    '  - { paso: "sql:refsede", despues_de: [] }',
    '  - { paso: "merge-prs-sync:sede", despues_de: ["push:demo-app", "sql:refsede"] }',
    '  - { paso: "manual:publish" }',
    '',
  ].join('\n'));
  const raiz = repoConRemoto();
  const head = git(raiz, 'rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  git(raiz, 'add', '.');
  git(raiz, 'commit', '-q', '-m', 'código');
  activar(raiz, base({ ...verde, aprobaciones: [okProd], base: head }));
  const ev = (cmd, real = () => false, sedes = {}) => evaluarBash({ comando: cmd, cwd: raiz, ctx: { textosUsuario: [FRASE_PROD], real, sedes }, dirLin });
  // Sin migraciones, sql:refprod1 no corresponde: el push pasa.
  assert.deepEqual(ev('git push'), { decision: 'allow', critica: true });
  const merge = 'gh pr merge 3 --merge --repo dueno/sede';
  assert.equal(ev(merge).motivo, 'Circuito de PROD: falta el paso push:demo-app antes de merge-prs-sync:sede.');
  // El estado real (push hecho por fuera, por PowerShell o la web) cuenta como hecho.
  assert.deepEqual(ev(merge, (p) => p === 'push:demo-app'), { decision: 'allow', critica: true });
  // Si el PR de sync de la sede trae una migración (anterior al RQ), el merge necesita su SQL.
  assert.equal(ev(merge, (p) => p === 'push:demo-app', { refsede: true }).motivo, 'Circuito de PROD: falta el paso sql:refsede antes de merge-prs-sync:sede.');
  // Con una migración, el merge de la sede necesita su SQL; el manual nunca bloquea.
  fs.mkdirSync(path.join(raiz, 'supabase', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'supabase', 'migrations', '1.sql'), 'x');
  assert.equal(ev(merge, (p) => p === 'push:demo-app').motivo, 'Circuito de PROD: falta el paso sql:refsede antes de merge-prs-sync:sede.');
  assert.equal(ev('git push').motivo, 'Circuito de PROD: falta el paso sql:refprod1 antes de push:demo-app.');
});

test('I3c/M11: escribir estado.yml, ACTIVO o el transcript desde Bash -> deny', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  for (const cmd of [
    'echo "etapa: 5" > docs/rq/R-1/estado.yml',
    'cat >> docs/rq/ACTIVO <<EOF\nR-9\nEOF',
    'printf x 2> docs/rq/R-1/estado.yml',
    "sed -i 's/etapa: 2/etapa: 5/' docs/rq/R-1/estado.yml",
    'echo R-9 | tee docs/rq/ACTIVO',
    'cp /tmp/falso.yml docs/rq/R-1/estado.yml',
    'mv otro.yml docs/rq/R-1/estado.yml',
    'cd docs/rq && echo R-2 > ACTIVO',
    'echo {} >> ~/.claude/projects/abc/sesion.jsonl',
  ]) {
    const r = evaluar(cmd, raiz);
    assert.equal(r.decision, 'deny', cmd);
    assert.ok(/estado\.yml y ACTIVO sólo se cambian con rq\.mjs|transcript/.test(r.motivo), r.motivo);
  }
  for (const cmd of ['cat docs/rq/R-1/estado.yml', 'cp docs/rq/R-1/estado.yml /tmp/copia.yml', 'echo x > docs/rq/R-1/relevo.md']) {
    assert.deepEqual(evaluar(cmd, raiz), { decision: 'allow', critica: false }, cmd);
  }
});

// Lineamientos temporal con un proyecto "p" descripto por su YAML.
function linCon(yml) {
  const dirLin = fs.mkdtempSync(path.join(os.tmpdir(), 'lin '));
  fs.mkdirSync(path.join(dirLin, 'proyectos', 'p'), { recursive: true });
  fs.writeFileSync(path.join(dirLin, 'proyectos', 'p', 'proyecto.yml'), yml);
  return dirLin;
}

test('M6: el orden del circuito compara pasos y repos sin distinguir mayúsculas', () => {
  const dirLin = linCon(
    'id: p\nrepos:\n  - { nombre: Demo-App, rol: padre, push_prod: true }\n' +
      'circuito_prod:\n  - { paso: "SQL:RefProd1" }\n  - { paso: "Push:Demo-App" }\n',
  );
  const raiz = crearRepoTemporal({ proyectoId: 'p', nombre: 'demo-app' });
  const ev = () => evaluarBash({ comando: 'git push', cwd: raiz, ctx: { textosUsuario: [FRASE_PROD] }, dirLin });
  activar(raiz, base({ ...verde, aprobaciones: [okProd] }));
  assert.match(ev().motivo ?? '', /^Circuito de PROD: falta el paso SQL:RefProd1 antes de /);
  activar(raiz, base({ ...verde, aprobaciones: [okProd], circuito: [paso('sql:refprod1')] }));
  assert.deepEqual(ev(), { decision: 'allow', critica: true });
});

test('M7: push desde un repo que no es padre y sin RQ sugiere correr el merge desde el padre', () => {
  const dirLin = linCon(
    'id: p\nrepos:\n  - { nombre: padre-app, rol: padre }\n  - { nombre: sede-app, rol: sede }\n',
  );
  const pista = 'Si el RQ vive en el padre, corré el merge desde el padre con --repo <owner>/<sede>.';
  const sede = crearRepoTemporal({ proyectoId: 'p', nombre: 'sede-app' });
  const r = evaluarBash({ comando: 'git push', cwd: sede, ctx: { textosUsuario: [] }, dirLin });
  assert.equal(r.decision, 'deny');
  assert.ok(r.motivo.startsWith('No hay RQ activo en '), r.motivo);
  assert.ok(r.motivo.endsWith(` ${pista}`), r.motivo);
  const padre = crearRepoTemporal({ proyectoId: 'p', nombre: 'padre-app' });
  const r2 = evaluarBash({ comando: 'git push', cwd: padre, ctx: { textosUsuario: [] }, dirLin });
  assert.ok(!r2.motivo.includes(pista), r2.motivo);
});

test('M8: proyecto sin comandos de tests -> el deny del commit sugiere el salto con las palabras del usuario', () => {
  const dirLin = linCon('id: p\nrepos:\n  - { nombre: p-app, rol: padre }\ntests:\n  unit: ""\n');
  const raiz = crearRepoTemporal({ proyectoId: 'p', nombre: 'p-app' });
  fs.writeFileSync(path.join(raiz, 'a.ts'), 'x');
  git(raiz, 'add', '.');
  activar(raiz, base());
  const r = evaluarBash({ comando: 'git commit -m x', cwd: raiz, ctx: { textosUsuario: [] }, dirLin });
  assert.equal(r.decision, 'deny');
  assert.ok(r.motivo.startsWith(MSG_TESTS), r.motivo);
  assert.match(r.motivo, /~\/\.claude\/bacg-dev\.json/, 'dice dónde declarar los tests de la PC');
  assert.ok(r.motivo.endsWith('Si el proyecto todavía no tiene tests, pedile al usuario que autorice `rq.mjs saltar commit "<sus palabras>" "sin tests todavía"`.'), r.motivo);
  // con tests declarados, el motivo no cambia
  const r2 = (() => {
    const otro = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
    fs.writeFileSync(path.join(otro, 'a.ts'), 'x');
    git(otro, 'add', '.');
    activar(otro, base());
    return evaluar('git commit -m x', otro);
  })();
  assert.equal(r2.motivo, MSG_TESTS);
});


// ---------- pasos del circuito marcados como no aplica ----------
// Lo publicado se mide desde estado.base (commit fijado al abrir el RQ), más lo no commiteado.

const noAplica = (p) => ({ paso: p, fecha: '2026-10-24T12:00:00Z', no_aplica: true, motivo: 'sin SQL' });
// Repo en demo-app con la base en el commit inicial y `archivos` commiteados después.
function repoConCambio(archivos = {}) {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const baseSha = git(raiz, 'rev-parse', 'HEAD').trim();
  for (const [rel, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), contenido);
  }
  git(raiz, 'add', '-A');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'cambio');
  return { raiz, baseSha };
}
const conNoAplica = (baseSha, pasos = ['sql:refprod1']) =>
  base({ ...verde, aprobaciones: [okProd], base: baseSha, circuito: pasos.map(noAplica) });

test('push con sql:refprod1 marcado como no aplica y sin migraciones -> allow', () => {
  const { raiz, baseSha } = repoConCambio({ 'src/a.tsx': 'x\n' });
  activar(raiz, conNoAplica(baseSha));
  assert.deepEqual(evaluar('git push', raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
  assert.deepEqual(evaluar('git push origin HEAD', raiz, [FRASE_PROD]), { decision: 'allow', critica: true });
});

test('push con sql:refprod1 no aplica pero con una migración publicada o suelta -> deny con la salida', () => {
  for (const [commiteada, suelta] of [[{ 'supabase/migrations/20261024_x.sql': 's\n' }, null], [{}, 'supabase/migrations/20261024_x.sql']]) {
    const { raiz, baseSha } = repoConCambio(commiteada);
    if (suelta) {
      fs.mkdirSync(path.join(raiz, 'supabase', 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(raiz, suelta), 's\n');
    }
    activar(raiz, conNoAplica(baseSha));
    const r = evaluar('git push', raiz, [FRASE_PROD]);
    assert.equal(r.decision, 'deny');
    assert.equal(r.critica, true);
    assert.equal(
      r.motivo,
      `Circuito de PROD: sql:refprod1 figura como no aplica, pero el cambio trae supabase/migrations/20261024_x.sql. Si corresponde, corré ${cli()} paso reabrir sql:refprod1 y hacé el paso.`,
    );
  }
});

test('push con un paso no aplica y refspec de otra rama, --all o --mirror -> deny', () => {
  const { raiz, baseSha } = repoConCambio({ 'src/a.tsx': 'x\n' });
  activar(raiz, conNoAplica(baseSha));
  for (const cmd of ['git push origin otra:main', 'git push origin otra', 'git push --all origin', 'git push --mirror origin']) {
    const r = evaluar(cmd, raiz, [FRASE_PROD]);
    assert.equal(r.decision, 'deny', cmd);
    assert.match(r.motivo, /^Circuito de PROD: con pasos marcados como no aplica sólo se pushea la rama actual \(HEAD\)/, cmd);
  }
});

test('push con un paso no aplica y sin base en el estado -> deny', () => {
  const { raiz } = repoConCambio({ 'src/a.tsx': 'x\n' });
  activar(raiz, base({ ...verde, aprobaciones: [okProd], circuito: [noAplica('sql:refprod1')] }));
  const r = evaluar('git push', raiz, [FRASE_PROD]);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^Circuito de PROD: el RQ no tiene base \(estado\.base\)/);
});

test('push de código: con tests.e2e declarado exige el E2E en verde (o salto e2e)', () => {
  const yml = fs
    .readFileSync(path.join(DIR_LIN, 'proyectos', 'demo', 'proyecto.yml'), 'utf8')
    .replace('push_prod: true', 'push_prod: false')
    .concat('  e2e: "npx playwright test"\n');
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app', archivos: { '.bacg-dev/proyecto.yml': yml } });
  activar(raiz, base({ ...verde }));
  const r = evaluar('git push', raiz);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^Falta el E2E en verde del RQ R-B1: corré \$RQ verificar/);
  activar(raiz, base({ ...verde, e2e: { ok: true } }));
  assert.equal(evaluar('git push', raiz).decision, 'allow');
  activar(raiz, base({ ...verde, saltos: [{ compuerta: 'e2e', frase: 'sin pantalla, salteá el e2e', motivo: 'script' }] }));
  assert.equal(evaluar('git push', raiz).decision, 'allow');
});

test('PROD exige las skills de proceso del tipo (o saltar skills) y el E2E completo si corrió parcial', () => {
  const { raiz } = repoConCambio({ 'src/a.tsx': 'x\n' });
  const listo = { ...verde, aprobaciones: [okProd], circuito: [paso('sql:refprod1')] };
  activar(raiz, base({ ...listo, skills: [] }));
  let r = evaluar('git push', raiz, [FRASE_PROD]);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /^PROD del RQ R-B1: falta superpowers:brainstorming; superpowers:test-driven-development; superpowers:verification-before-completion/);
  activar(raiz, base({ ...listo, skills: [], saltos: [{ compuerta: 'skills', frase: 'salteá las skills', motivo: 'urgente' }] }));
  assert.equal(evaluar('git push', raiz, [FRASE_PROD]).decision, 'allow');
  activar(raiz, base({ ...listo, e2e: { ok: true, completo: false } }));
  r = evaluar('git push', raiz, [FRASE_PROD]);
  assert.match(r.motivo, /verificar --completo/);
});

test('$RQ armado con node adentro (RQ=\'node …/rq.mjs\'; $RQ aprobar …) se lee y valida la frase', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const cmd = (f) => `RQ='node C:/x/rq.mjs'; $RQ aprobar 5 "${f}" --rq E-1 2>&1 | tail -2`;
  assert.equal(evaluar(cmd('OK PROD sedes'), raiz, ['OK PROD sedes']).decision, 'allow');
  assert.equal(evaluar(cmd('inventada'), raiz, ['OK PROD sedes']).decision, 'deny');
});

// ---------- M5 y M7: árbol testeado, ramas sólo-PR y frase de clasificacion ----------

// Copia de los lineamientos de prueba con `ramas_solo_pr` declarada en el proyecto demo.
function dirLinSoloPr(ramas) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-solo-pr-'));
  fs.cpSync(DIR_LIN, d, { recursive: true });
  const yml = path.join(d, 'proyectos', 'demo', 'proyecto.yml');
  fs.appendFileSync(yml, `ramas_solo_pr: [${ramas.join(', ')}]\n`);
  return d;
}

test('commit en rama sólo-PR se niega; con saltar rama se permite', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  git(raiz, 'branch', '-M', '18.0-dev');
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  git(raiz, 'add', '.');
  const dirLin = dirLinSoloPr(['18.0-dev']);
  const ev = (textos = []) => evaluarBash({ comando: 'git commit -m x', cwd: raiz, ctx: { textosUsuario: textos }, dirLin });

  activar(raiz, base({ tests: { ok: true, arbol: arbolEnStage(raiz) } }));
  const r = ev();
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /sólo recibe cambios por PR/);
  assert.match(r.motivo, /rq\/R-B1/);

  const frase = 'Commiteá en la rama protegida, lo asumo';
  activar(raiz, base({ tests: { ok: true, arbol: arbolEnStage(raiz) }, saltos: [{ compuerta: 'rama', frase, motivo: 'm', fecha: 'f' }] }));
  assert.deepEqual(ev([frase]), { decision: 'allow', critica: false });

  // En la rama del RQ el mismo commit pasa sin salto.
  git(raiz, 'switch', '-q', '-c', 'rq/R-B1');
  activar(raiz, base({ tests: { ok: true, arbol: arbolEnStage(raiz) } }));
  assert.deepEqual(ev(), { decision: 'allow', critica: false });
});

test('commit con estado.yml en stage tras registrar-tests pasa', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.ts'), 'x');
  git(raiz, 'add', 'src/a.ts');
  activar(raiz, base({ tests: { ok: true, arbol: arbolTesteado(raiz) } }));
  // La CLI escribió estado.yml después de registrar y el commit lo lleva en stage.
  git(raiz, 'add', 'docs/rq/R-B1/estado.yml', 'docs/rq/ACTIVO');
  assert.ok(archivosEnStage(raiz).includes('docs/rq/R-B1/estado.yml'));
  assert.notEqual(arbolEnStage(raiz), arbolTesteado(raiz));
  assert.deepEqual(evaluar('git commit -m x', raiz), { decision: 'allow', critica: false });
});

test('clasificacion cambiar sin frase literal se niega; con la frase se permite', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const frase = 'Pasalo a arquitectónico';
  const cmd = `node "$RQ" clasificacion cambiar arquitectonico "${frase}" --rq R-B1`;
  const r = evaluar(cmd, raiz, ['otra cosa']);
  assert.equal(r.decision, 'deny');
  assert.match(r.motivo, /tiene que ser texto literal del usuario/);
  assert.deepEqual(evaluar(cmd, raiz, [`Dale, ${frase}.`]), { decision: 'allow', critica: false });
  // Forma sin `cambiar`: la frase va en la posición 3.
  const cmd2 = `node "$RQ" clasificacion bounded "${frase}"`;
  assert.equal(evaluar(cmd2, raiz, ['otra cosa']).decision, 'deny');
  assert.equal(evaluar(cmd2, raiz, [frase]).decision, 'allow');
});

test('Exploración: el commit de código fuera de docs/rq/<código>/ se niega; la sonda se permite', () => {
  const raiz = crearRepoTemporal({ proyectoId: 'demo', nombre: 'demo-app' });
  const msg = 'Exploración: el código de la sonda va a docs/rq/R-1/sonda/; construirlo es un RQ nuevo.';
  fs.mkdirSync(path.join(raiz, 'src'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'src', 'a.js'), 'x');
  git(raiz, 'add', '.');
  activar(raiz, base({ codigo: 'R-1', clasificacion: 'spike', tests: { ok: true, arbol: arbolEnStage(raiz) } }));
  const r = evaluar('git commit -m x', raiz);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, msg);

  git(raiz, 'reset', '-q');
  fs.rmSync(path.join(raiz, 'src'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'docs', 'rq', 'R-1', 'sonda'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'docs', 'rq', 'R-1', 'sonda', 'a.js'), 'x');
  git(raiz, 'add', 'docs/rq/R-1/sonda/a.js');
  assert.equal(evaluar('git commit -m x', raiz).decision, 'allow');
});
