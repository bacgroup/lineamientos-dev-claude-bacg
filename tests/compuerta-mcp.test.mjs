import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esSqlSoloLectura, evaluarMcp } from '../plugin/scripts/lib/compuerta-mcp.mjs';
import { cargarProyecto } from '../plugin/scripts/lib/config.mjs';

const DIR_LIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lineamientos');
const proyecto = cargarProyecto('demo', DIR_LIN);
const SB = 'mcp__c57e95c1-9b90-4ee5-a961-dcd94156bdf7__';
const LOV = 'mcp__1d1c8098-ee55-4718-b381-babd223e1b53__';
const FRASE6 = 'Publicá demo-app a producción';
const ok6 = { etapa: 6, frase: FRASE6, fecha: '2026-10-23T12:00:00Z' };

const base = (extra = {}) => ({
  codigo: 'R-M1', tipo: 'rq', clasificacion: 'bounded', etapa: 6,
  autonomia: null, aprobaciones: [], saltos: [], circuito: [], ...extra,
});
const ctxSesion = { textosUsuario: [FRASE6], commiteado: null, raiz: null };
const ctxVacio = { textosUsuario: [], commiteado: null, raiz: null };

const ev = (toolName, toolInput, estado = null, ctx = ctxVacio, p = proyecto) =>
  evaluarMcp({ toolName, toolInput, proyecto: p, estado, ctx });

// --- esSqlSoloLectura ---

test('esSqlSoloLectura: casos del brief', () => {
  assert.equal(esSqlSoloLectura('select * from t'), true);
  assert.equal(esSqlSoloLectura('with x as (delete from t returning *) select * from x'), false);
  assert.equal(esSqlSoloLectura('select 1; drop table t'), false);
  assert.equal(esSqlSoloLectura("select 'drop'"), true);
});

test('esSqlSoloLectura: casos adicionales', () => {
  assert.equal(esSqlSoloLectura('SELECT 1'), true);
  assert.equal(esSqlSoloLectura('  (select 1)'), true);
  assert.equal(esSqlSoloLectura('explain analyze delete from t'), false);
  assert.equal(esSqlSoloLectura('select * into nueva from t'), false);
  assert.equal(esSqlSoloLectura('select pg_terminate_backend(1)'), false);
  assert.equal(esSqlSoloLectura("select set_config('a','b',false)"), false);
  assert.equal(esSqlSoloLectura('select $$drop$$'), true);
  assert.equal(esSqlSoloLectura('select "update" from t'), true);
  assert.equal(esSqlSoloLectura('-- drop\nselect 1'), true);
  assert.equal(esSqlSoloLectura('select 1; '), true);
  assert.equal(esSqlSoloLectura(''), false);
  assert.equal(esSqlSoloLectura('begin; select 1'), false);
});

test('esSqlSoloLectura: strings, comentarios y entradas raras', () => {
  assert.equal(esSqlSoloLectura("select 'it''s; drop table t'"), true);
  assert.equal(esSqlSoloLectura('select $tag$ ; delete $tag$'), true);
  assert.equal(esSqlSoloLectura('/* drop */ select 1'), true);
  assert.equal(esSqlSoloLectura('show search_path'), true);
  assert.equal(esSqlSoloLectura('table t'), true);
  assert.equal(esSqlSoloLectura('values (1)'), true);
  assert.equal(esSqlSoloLectura('select nextval(\'s\')'), false);
  assert.equal(esSqlSoloLectura('select * from dblink(\'x\', \'y\')'), false);
  assert.equal(esSqlSoloLectura('update t set a = 1'), false);
  assert.equal(esSqlSoloLectura('select "pg_terminate_backend"(1)'), false);
  assert.equal(esSqlSoloLectura("select 'sin cerrar"), false);
  assert.equal(esSqlSoloLectura('select 1 /* sin cerrar'), false);
  assert.equal(esSqlSoloLectura('select created_at, offset_x from t where a = $1'), true);
  assert.equal(esSqlSoloLectura(';;'), false);
  assert.equal(esSqlSoloLectura(null), false);
  assert.equal(esSqlSoloLectura(42), false);
});

// --- evaluarMcp: SQL a PROD ---

test('apply_migration a refprod1 sin OK → deny crítica', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'create table t()' }, base());
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.match(r.motivo, /etapa 6/);
});

test('T8: el sufijo de la herramienta no distingue mayúsculas', () => {
  const r = ev('mcp__x__EXECUTE_SQL', { project_id: 'refprod1', query: 'delete from t' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(ev('mcp__x__Deploy_Project', {}).decision, 'deny');
});

test('apply_migration a refprod1 sin RQ → deny crítica', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'select 1' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'SQL de escritura a PROD (refprod1) sin RQ activo.');
});

test('apply_migration a refprod1 con OK de sesión → allow crítica', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'create table t()' },
    base({ aprobaciones: [ok6] }), ctxSesion);
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, true);
});

test('OK de etapa 6: tiene que estar en la sesión al usarlo; sin OK → deny', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'drop table t' }, base({ aprobaciones: [ok6] }));
  assert.equal(r.decision, 'deny');
  assert.deepEqual(ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'drop table t' }, base({ aprobaciones: [ok6] }), ctxSesion),
    { decision: 'allow', critica: true });
  const sin = ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'drop table t' }, base());
  assert.equal(sin.motivo, 'SQL de escritura a PROD (refprod1): falta el OK del usuario para PROD (etapa 6).');
});

test('varios RQ activos: alcanza con que uno tenga el OK de PROD y el circuito', () => {
  const r = evaluarMcp({ toolName: SB + 'apply_migration', toolInput: { project_id: 'refprod1', name: 'm', query: 'drop table t' },
    proyecto, estado: base(), estados: [base({ codigo: 'R-M2', aprobaciones: [ok6] }), base()], ctx: ctxSesion });
  assert.deepEqual(r, { decision: 'allow', critica: true });
});

test('apply_migration a refprod2 con OK pero sin push:demo-app → deny', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refprod2', name: 'm', query: 'create table t()' },
    base({ aprobaciones: [ok6], circuito: [{ paso: 'sql:refprod1', fecha: 'x' }] }), ctxSesion);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Circuito de PROD: falta el paso push:demo-app antes de sql:refprod2.');
});

test('apply_migration a refprod2 con circuito completo → allow', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refprod2', name: 'm', query: 'create table t()' },
    base({ aprobaciones: [ok6], circuito: [{ paso: 'sql:refprod1' }, { paso: 'push:demo-app' }] }), ctxSesion);
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, true);
});

test('los saltos no saltean la compuerta de SQL a PROD', () => {
  const est = base({ saltos: [{ compuerta: 'push', frase: FRASE6 }, { compuerta: 'sql', frase: FRASE6 }] });
  const r = ev(SB + 'execute_sql', { project_id: 'refprod1', query: 'delete from t' }, est, ctxSesion);
  assert.equal(r.decision, 'deny');
});

test('execute_sql de lectura a PROD sin RQ → allow no crítica', () => {
  const r = ev(SB + 'execute_sql', { project_id: 'refprod1', query: 'select * from t' });
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, false);
});

test('execute_sql de escritura a PROD sin RQ → deny crítica', () => {
  const r = ev(SB + 'execute_sql', { project_id: 'refprod2', query: 'update t set a = 1' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'SQL de escritura a PROD (refprod2) sin RQ activo.');
});

test('un ref que no es de PROD → allow sin RQ', () => {
  const r = ev(SB + 'apply_migration', { project_id: 'refdev', name: 'm', query: 'drop table t' });
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, false);
});

test('proyecto ausente → SQL allow', () => {
  const r = ev(SB + 'execute_sql', { project_id: 'refprod1', query: 'drop table t' }, null, ctxVacio, null);
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, false);
});

// --- evaluarMcp: Lovable ---

test('deploy_project sin RQ → deny crítica', () => {
  const r = ev(LOV + 'deploy_project', { project_id: 'lovprj1' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Deploy de Lovable sin RQ activo.');
});

test('deploy_project sin OK de sesión → deny crítica', () => {
  const r = ev(LOV + 'deploy_project', { project_id: 'lovprj1' }, base());
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.equal(r.motivo, 'Deploy de Lovable es PROD: falta el OK del usuario para PROD (etapa 6).');
});

test('deploy_project con etapa 6 en sesión → allow crítica', () => {
  const r = ev(LOV + 'deploy_project', { project_id: 'lovprj1' }, base({ aprobaciones: [ok6] }), ctxSesion);
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, true);
});

test('deploy_project con proyecto ausente sigue siendo crítico', () => {
  const r = ev(LOV + 'deploy_project', { project_id: 'otro' }, null, ctxVacio, undefined);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
});

test('send_message a lovprj1 sin RQ → allow (Lovable aplica sus propios controles)', () => {
  assert.deepEqual(ev(LOV + 'send_message', { project_id: 'lovprj1', message: 'hola' }), { decision: 'allow', critica: false });
});

test('send_message a lovprj1 con RQ → allow', () => {
  const r = ev(LOV + 'send_message', { project_id: 'lovprj1', message: 'hola' }, base());
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, false);
});

test('send_message a otro proyecto → allow', () => {
  const r = ev(LOV + 'send_message', { project_id: 'otro', message: 'hola' });
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, false);
});

test('otra herramienta → allow', () => {
  const r = ev(SB + 'list_tables', { project_id: 'refprod1' });
  assert.equal(r.decision, 'allow');
  assert.equal(r.critica, false);
});

test('entradas raras no tiran', () => {
  assert.equal(evaluarMcp({}).decision, 'allow');
  const sinInput = evaluarMcp({ toolName: SB + 'execute_sql', toolInput: null, proyecto });
  assert.equal(sinInput.decision, 'deny');
  assert.equal(sinInput.critica, true);
  const r = evaluarMcp({ toolName: SB + 'execute_sql', toolInput: { project_id: 'refprod1' }, proyecto });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
});

// --- Ronda 1 de revisión ---

test('C1: strings E con escapes de barra', () => {
  assert.equal(esSqlSoloLectura("select E'\\''; delete from t; --'"), false);
  assert.equal(esSqlSoloLectura("select e'a\\'b'"), true);
});

test('C2: comentarios de bloque anidados', () => {
  assert.equal(esSqlSoloLectura("select 1 /* /* */ ' */ ; delete from t; -- '"), false);
  assert.equal(esSqlSoloLectura('select 1 /* a /* b */ c */'), true);
});

test('C3: dollar quotes sólo si el $ no sigue a un identificador', () => {
  assert.equal(esSqlSoloLectura("select 1 as a$x$; delete from t; select 'x' as b$x$"), false);
  assert.equal(esSqlSoloLectura('select 1 a$$; drop table t; select 1 b$$'), false);
  assert.equal(esSqlSoloLectura('select $$drop$$'), true);
});

test('C3b: literales U& fallan cerrados', () => {
  assert.equal(esSqlSoloLectura("select U&'d\\0061ta'"), false);
  assert.equal(esSqlSoloLectura('select u&"x" from t'), false);
});

test('C4: lista blanca de funciones', () => {
  assert.equal(esSqlSoloLectura('select apply_renewals()'), false);
  assert.equal(esSqlSoloLectura('select public.apply_renewals()'), false);
  assert.equal(esSqlSoloLectura('select "apply_renewals"()'), false);
  assert.equal(esSqlSoloLectura("select cron.schedule('j','* * * * *','x')"), false);
  assert.equal(esSqlSoloLectura("select net.http_post('u')"), false);
  assert.equal(esSqlSoloLectura("select query_to_xml('x',true,true,'')"), false);
  assert.equal(esSqlSoloLectura('select count(*), coalesce(sum(x),0) from t'), true);
  assert.equal(esSqlSoloLectura("select date_trunc('day', created_at), to_char(now(),'YYYY') from t"), true);
  assert.equal(esSqlSoloLectura("select pg_get_functiondef('f'::regproc)"), true);
  assert.equal(esSqlSoloLectura('select row_number() over (partition by a order by b) from t'), true);
  assert.equal(esSqlSoloLectura('select cast(x as numeric(10,2)) from t'), true);
  assert.equal(esSqlSoloLectura('select * from t where id in (select id from u)'), true);
  assert.equal(esSqlSoloLectura('select exists(select 1)'), true);
});

test('palabras prohibidas nuevas', () => {
  for (const s of [
    'select * from t for share', 'select * from t for update nowait', 'explain analyse select 1',
    'begin', 'select 1; commit', 'select 1; rollback', 'start transaction', 'savepoint a',
  ]) assert.equal(esSqlSoloLectura(s), false, s);
});

test('I5: project_id normalizado y obligatorio', () => {
  const r = ev(SB + 'execute_sql', { project_id: ' REFPROD1 ', query: 'delete from t' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.match(r.motivo, /PROD \(refprod1\) sin RQ activo/);
  const sinId = ev(SB + 'apply_migration', { name: 'm', query: 'select 1' });
  assert.equal(sinId.decision, 'deny');
  assert.equal(sinId.critica, true);
  assert.equal(sinId.motivo, 'Herramienta apply_migration sin project_id: no se puede verificar si el destino es PROD.');
  const noStr = ev(SB + 'execute_sql', { project_id: 7, query: 'select 1' });
  assert.equal(noStr.decision, 'deny');
});

test('I6: herramientas de Supabase que tocan PROD', () => {
  for (const t of ['deploy_edge_function', 'restore_project', 'pause_project']) {
    const sinRq = ev(SB + t, { project_id: 'refprod1' });
    assert.equal(sinRq.decision, 'deny', t);
    assert.equal(sinRq.critica, true, t);
    assert.equal(ev(SB + t, { project_id: 'refprod1' }, base()).decision, 'deny', t);
    const ok = ev(SB + t, { project_id: 'refprod1' }, base({ aprobaciones: [ok6] }), ctxSesion);
    assert.deepEqual(ok, { decision: 'allow', critica: true }, t);
    assert.deepEqual(ev(SB + t, { project_id: 'refdev' }), { decision: 'allow', critica: false }, t);
    assert.equal(ev(SB + t, {}).decision, 'deny', t);
  }
  for (const t of ['merge_branch', 'reset_branch']) {
    assert.equal(ev(SB + t, { branch_id: 'b1' }).decision, 'deny', t);
    const ok = ev(SB + t, { branch_id: 'b1' }, base({ aprobaciones: [ok6] }), ctxSesion);
    assert.deepEqual(ok, { decision: 'allow', critica: true }, t);
    assert.deepEqual(ev(SB + t, { branch_id: 'b1' }, null, ctxVacio, null), { decision: 'allow', critica: false }, t);
  }
  assert.deepEqual(ev(SB + 'create_branch', { project_id: 'refprod1' }), { decision: 'allow', critica: false });
});

test('I6: query_database de Lovable', () => {
  assert.deepEqual(ev(LOV + 'query_database', { project_id: 'lovprj1', sql: 'select * from t' }),
    { decision: 'allow', critica: false });
  const w = ev(LOV + 'query_database', { project_id: 'lovprj1', sql: 'delete from t' });
  assert.equal(w.decision, 'deny');
  assert.equal(w.critica, true);
  assert.equal(ev(LOV + 'query_database', { project_id: 'lovprj1', sql: 'delete from t' }, base()).decision, 'deny');
  assert.deepEqual(
    ev(LOV + 'query_database', { project_id: 'lovprj1', sql: 'delete from t' }, base({ aprobaciones: [ok6] }), ctxSesion),
    { decision: 'allow', critica: true });
  assert.deepEqual(ev(LOV + 'query_database', { project_id: 'otro', sql: 'delete from t' }),
    { decision: 'allow', critica: false });
});

test('I6: respond_to_approval de Lovable', () => {
  const sinRq = ev(LOV + 'respond_to_approval', { project_id: 'lovprj1', decision: 'approved' });
  assert.equal(sinRq.decision, 'deny');
  assert.equal(sinRq.critica, true);
  const sinOk = ev(LOV + 'respond_to_approval', { project_id: 'otro', decision: 'approved' }, base());
  assert.equal(sinOk.motivo,
    'Aprobar una acción del agente de Lovable es PROD: falta el OK del usuario para PROD (etapa 6).');
  assert.deepEqual(
    ev(LOV + 'respond_to_approval', { project_id: 'lovprj1' }, base({ aprobaciones: [ok6] }), ctxSesion),
    { decision: 'allow', critica: true });
});



// --- Ronda 2 de revisión ---

test('R2-1: caracteres no ASCII son parte de identificadores', () => {
  assert.equal(esSqlSoloLectura('select 1 as é$$, apply_renewals() as x, 2 as y$$'), false);
  assert.equal(esSqlSoloLectura('select cobrá()'), false);
  assert.equal(esSqlSoloLectura('select ñandú()'), false);
  // `ñandú$$x$$` es un identificador (los $ siguen a un carácter de identificador): no abre dollar quote.
  assert.equal(esSqlSoloLectura('select ñandú$$x$$ from t'), true);
  assert.equal(esSqlSoloLectura('select ñandú$$x$$; delete from t; select 1 b$$'), false);
  // Tag de dollar quote no ASCII.
  assert.equal(esSqlSoloLectura('select $ñ$ ; delete $ñ$'), true);
  // E-string: una é antes de e hace que no sea prefijo E.
  assert.equal(esSqlSoloLectura("select ée'\\'; delete from t; --'"), false);
  assert.equal(esSqlSoloLectura('select count(*) from t'), true);
});

test('R2-2: campos señuelo en herramientas con SQL', () => {
  const q = ev(LOV + 'query_database', { project_id: 'lovprj1', query: 'select 1', sql: 'delete from t' });
  assert.equal(q.decision, 'deny');
  assert.equal(q.critica, true);
  const e = ev(SB + 'execute_sql', { project_id: 'refprod1', query: 'select 1', extra: 'delete from t' });
  assert.equal(e.decision, 'deny');
  assert.equal(e.critica, true);
  const obj = ev(SB + 'execute_sql', { project_id: 'refprod1', query: 'select 1', extra: ['delete from t'] });
  assert.equal(obj.decision, 'deny');
  const sinSql = ev(SB + 'execute_sql', { project_id: 'refprod1' });
  assert.equal(sinSql.decision, 'deny');
  assert.deepEqual(ev(SB + 'execute_sql', { project_id: 'refprod1', query: 'select 1', read_only: true }),
    { decision: 'allow', critica: false });
});

test('R2-4: herramientas de ramas ignoran project_id', () => {
  for (const t of ['merge_branch', 'reset_branch']) {
    const r = ev(SB + t, { branch_id: 'b1', project_id: 'refdev' }, base());
    assert.equal(r.decision, 'deny', t);
    assert.equal(r.critica, true, t);
    assert.match(r.motivo, /etapa 6/, t);
    assert.deepEqual(ev(SB + t, { branch_id: 'b1', project_id: 'refdev' }, base({ aprobaciones: [ok6] }), ctxSesion),
      { decision: 'allow', critica: true }, t);
  }
});

test('SQL a refprod2 con sql:refprod1 marcado como no aplica → deny: correr SQL contradice el no aplica', () => {
  const circuito = [{ paso: 'sql:refprod1', no_aplica: true, motivo: 'sin SQL' }, { paso: 'push:demo-app' }];
  const r = ev(SB + 'apply_migration', { project_id: 'refprod2', name: 'm', query: 'create table t()' },
    base({ aprobaciones: [ok6], circuito }), ctxSesion);
  assert.equal(r.decision, 'deny');
  assert.equal(r.motivo, 'Circuito de PROD: falta el paso sql:refprod1 antes de sql:refprod2.');
});

test('SQL a un ref marcado como no aplica → deny con la salida', () => {
  const circuito = [{ paso: 'sql:refprod1', no_aplica: true, motivo: 'sin SQL' }];
  const r = ev(SB + 'apply_migration', { project_id: 'refprod1', name: 'm', query: 'create table t()' },
    base({ aprobaciones: [ok6], circuito }), ctxSesion);
  assert.equal(r.decision, 'deny');
  assert.equal(r.critica, true);
  assert.match(r.motivo, /^sql:refprod1 figura como no aplica en este RQ: si hace falta correr SQL, corré .* paso reabrir sql:refprod1\.$/);
});
