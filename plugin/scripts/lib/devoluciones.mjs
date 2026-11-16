// Devoluciones como lista cerrada (PLG-DFF2, P-11 y P-14). Cada punto que marca el usuario sobre lo entregado se anota
// numerado en estado.devoluciones (pendiente | hecho | consultado | rechazado). Un punto se cierra con evidencia (una
// captura, un test o la respuesta del usuario). Con reglas 4.4 la revisión no se da por ok mientras quede alguno
// pendiente. Al segundo punto sobre el mismo elemento se corta la iteración "a ojo".
const lista = (x) => (Array.isArray(x) ? x : []);

export const ESTADOS_DEVOLUCION = ['hecho', 'consultado', 'rechazado'];

export const PROTOCOLO_CORTE = (elemento, n) => `Corte por vueltas: "${elemento}" ya recibió ${n} devoluciones. Antes de tocarlo otra vez:
  1. Sacá una captura del estado actual junto a la referencia (o al mockup aprobado).
  2. Escribí la causa raíz en una línea.
  3. Transcribí literal lo que pidió el usuario sobre "${elemento}" (sin interpretar).
  4. Presentá mockups que cumplan esa transcripción y esperá la elección del usuario.
No hay una vuelta más "a ojo".`;

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Agrega un punto pendiente. Devuelve { n, corte } (corte: hay 2 o más puntos sobre el mismo elemento). */
export function agregar(estado, texto, elemento, fecha) {
  const actual = lista(estado.devoluciones);
  const n = actual.reduce((m, d) => Math.max(m, Number(d?.n) || 0), 0) + 1;
  const punto = { n, texto: String(texto).trim(), estado: 'pendiente', fecha, ...(elemento ? { elemento: String(elemento).trim() } : {}) };
  estado.devoluciones = [...actual, punto];
  const mismos = elemento ? estado.devoluciones.filter((d) => norm(d.elemento) === norm(elemento)).length : 0;
  return { n, corte: mismos >= 2, vueltas: mismos };
}

/** Cierra un punto con su evidencia. Devuelve un mensaje de error o null. */
export function marcar(estado, n, nuevo, evidencia, fecha) {
  if (!ESTADOS_DEVOLUCION.includes(nuevo)) return `Estado inválido: "${nuevo}" (${ESTADOS_DEVOLUCION.join(' | ')}).`;
  if (typeof evidencia !== 'string' || !evidencia.trim()) return `Cerrar un punto pide evidencia: una captura, un test o la respuesta del usuario.`;
  const d = lista(estado.devoluciones).find((x) => Number(x?.n) === Number(n));
  if (!d) return `No hay un punto ${n} en las devoluciones del RQ.`;
  d.estado = nuevo;
  d.evidencia = evidencia.trim();
  d.cerrado = fecha;
  return null;
}

export const pendientes = (estado) => lista(estado?.devoluciones).filter((d) => d?.estado === 'pendiente');

export function listado(estado) {
  const ds = lista(estado?.devoluciones);
  if (!ds.length) return 'Sin devoluciones registradas.';
  const lineas = ds.map((d) => `  ${d.n}. [${d.estado}]${d.elemento ? ` (${d.elemento})` : ''} ${d.texto}${d.evidencia ? ` · ${d.evidencia}` : ''}`);
  return `Devoluciones (${pendientes(estado).length} pendiente(s) de ${ds.length}):\n${lineas.join('\n')}`;
}
