// Numeración de etapas del ciclo (v4: 0 a 6, Diseño y Plan juntos en la 1) y conversión desde la v3 (0 a 7).
//
// Un estado.yml sin `version_ciclo: 4` es de un RQ abierto con 3.x: se convierte al leerlo (cargarEstado) y se
// escribe en v4 recién en el próximo comando que lo guarde. Lo mismo un proyecto.yml sin `version_ciclo: 4`: sus
// `skills_requeridas[].etapa` se leen en la numeración vieja.

export const VERSION_CICLO = 4;

export const ETAPA = Object.freeze({ ARRANQUE: 0, DISENO: 1, DESARROLLO: 2, VERIFICACION: 3, DEV: 4, PROD: 5, CIERRE: 6 });

export const NOMBRE_ETAPA = Object.freeze({
  0: 'Arranque y clasificación',
  1: 'Diseño y plan',
  2: 'Desarrollo',
  3: 'Verificación',
  4: 'DEV / Preview',
  5: 'PROD y entrega',
  6: 'Cierre',
});

// Clasificaciones cuyo diseño en 3.x se cumplía con spec.md, sin aprobación.
export const CLASIFICACIONES_DISENO_V3 = Object.freeze(['spike', 'bounded']);

const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** Etapa v3 (0..7) a v4: 0→0, 1→1, 2→1, del 3 en adelante −1. Lo que no es una etapa v3 queda igual. */
export function etapaV3aV4(n) {
  if (!Number.isInteger(n) || n < 0 || n > 7) return n;
  return n >= 2 ? n - 1 : n;
}

/** Etapa de `skills_requeridas` de un proyecto.yml: tal cual con `version_ciclo: 4`; si no, se convierte. */
export function etapaProyectoAV4(proyecto, n) {
  return proyecto?.version_ciclo === VERSION_CICLO ? n : etapaV3aV4(n);
}

/**
 * Estado en numeración v4. Uno ya v4 (o que no es un objeto) vuelve tal cual; uno v3 vuelve como copia convertida
 * (etapa, aprobaciones[].etapa, autonomia.hasta) con `version_ciclo: 4` y `_v3: true`, que guardarEstado no escribe.
 * Dos aprobaciones que caen en la misma etapa (Diseño y Plan) quedan las dos. No muta el original.
 * En 3.x el diseño de spike y bounded lo cubría spec.md: esos estados ganan `diseno_v3: true`, que sí se guarda, para
 * que la etapa 1 siga cumplida con spec.md (sin `aprobar 1`) después de reescribirlos en v4.
 */
export function aV4(estado) {
  if (!esObjeto(estado) || estado.version_ciclo === VERSION_CICLO) return estado;
  const e = structuredClone(estado);
  if ('etapa' in e) e.etapa = etapaV3aV4(e.etapa);
  if (Array.isArray(e.aprobaciones)) {
    e.aprobaciones = e.aprobaciones.map((a) => (esObjeto(a) && 'etapa' in a ? { ...a, etapa: etapaV3aV4(a.etapa) } : a));
  }
  if (esObjeto(e.autonomia) && 'hasta' in e.autonomia) e.autonomia = { ...e.autonomia, hasta: etapaV3aV4(e.autonomia.hasta) };
  if (CLASIFICACIONES_DISENO_V3.includes(e.clasificacion)) e.diseno_v3 = true;
  e.version_ciclo = VERSION_CICLO;
  e._v3 = true;
  return e;
}
