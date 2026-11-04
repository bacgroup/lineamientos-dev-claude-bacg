// Entrada del hook PostToolUse. Sin imports estáticos: lee stdin y carga el handler; si algo falla
// (incluida la carga de módulos), deja pasar con un aviso.

const resumir = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').trim().slice(0, 300);

let texto = '';
try {
  process.stdin.setEncoding('utf8');
  for await (const trozo of process.stdin) texto += trozo;
} catch {
  // stdin ilegible: se sigue con lo leído
}

try {
  const modulo = process.env.COMO_TRABAJO_FALLAR_IMPORT === '1' ? '../lib/hooks/no-existe.mjs' : '../lib/hooks/post-tool.mjs';
  const [{ handler }, { responder }] = await Promise.all([import(modulo), import('../lib/salida.mjs')]);
  await responder(handler, texto, false);
} catch (e) {
  process.stdout.write(JSON.stringify({ systemMessage: `Aviso: compuerta no evaluada (${resumir(e)})` }));
}
