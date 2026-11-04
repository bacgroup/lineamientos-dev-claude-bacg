// Respuesta de los hooks y política de falla.
//
// Las entradas (plugin/scripts/hooks/*.mjs) leen stdin, calculan la criticidad sin depender de ningún
// módulo y llaman a `responder`. Si el handler lanza (o la entrada no es JSON válido): con `critica` se
// bloquea (falla cerrada); si no, se deja pasar con un aviso en `systemMessage` (falla abierta).
// Nunca se sale con código distinto de 0 por una decisión de política.

export const resumirError = (e) =>
  String(e?.message ?? e)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

export const denegar = (motivo) => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo },
});

export const contexto = (evento, texto) => ({
  hookSpecificOutput: { hookEventName: evento, additionalContext: texto },
});

export const falla = (e, critica) =>
  critica
    ? denegar(`Compuerta de PROD no pudo evaluarse (${resumirError(e)}). Se bloquea por seguridad.`)
    : { systemMessage: `Aviso: compuerta no evaluada (${resumirError(e)})` };

/** Parsea `texto`, corre `fn(entrada)` y escribe la respuesta (nada si es null), con la política de falla. */
export async function responder(fn, texto, critica, stdout = process.stdout) {
  let salida;
  try {
    salida = await fn(JSON.parse(texto));
  } catch (e) {
    salida = falla(e, critica === true);
  }
  if (salida !== null && salida !== undefined) stdout.write(JSON.stringify(salida));
}
