// Árbol testeado: el hash del árbol en stage sin los archivos que escribe la propia CLI (estado.yml de cada RQ,
// docs/rq/ACTIVO y docs/backlog.md). Así registrar-tests puede dejar su estado.yml en el mismo commit del código
// sin invalidar los tests que acaba de registrar (M5 del handoff ciclo-rq/UI).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (dir, args, env) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) }).trim();

/** Pathspecs (desde el toplevel de git, en cualquier subcarpeta) de los archivos que escribe la CLI del RQ. */
export const PROPIOS_DE_LA_CLI = [':(glob)**/docs/rq/*/estado.yml', ':(glob)**/docs/rq/ACTIVO', ':(glob)**/docs/backlog.md'];

/** ¿La ruta (relativa, POSIX) es un archivo que escribe la CLI del RQ? */
export const esPropioDeLaCli = (rel) => /(?:^|\/)docs\/(?:rq\/(?:[^/]+\/estado\.yml|ACTIVO)|backlog\.md)$/.test(String(rel ?? '').replace(/\\/g, '/'));

/** Hash del árbol en stage tal cual (git write-tree). */
export const arbolCompleto = (dir) => git(dir, ['write-tree']);

/**
 * Hash del árbol en stage sin los archivos de la CLI. Trabaja sobre una copia del índice (GIT_INDEX_FILE), así el
 * stage real no cambia.
 */
export function arbolTesteado(dir) {
  const indice = path.resolve(dir, git(dir, ['rev-parse', '--git-path', 'index']));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-indice-'));
  const copia = path.join(tmp, 'index');
  try {
    if (fs.existsSync(indice)) fs.copyFileSync(indice, copia);
    const env = { ...process.env, GIT_INDEX_FILE: copia };
    git(dir, ['rm', '--cached', '-f', '-q', '-r', '--ignore-unmatch', '--', ...PROPIOS_DE_LA_CLI], env);
    return git(dir, ['write-tree'], env);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** ¿Los tests registrados valen para lo que hay en stage? Acepta el árbol testeado y, por compatibilidad, el completo. */
export function testsValenParaStage(tests, dir) {
  if (tests?.ok !== true || typeof tests.arbol !== 'string') return false;
  return tests.arbol === arbolTesteado(dir) || tests.arbol === arbolCompleto(dir);
}
