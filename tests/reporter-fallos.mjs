// Reporter de node:test para la CLI del plugin: imprime "FAIL <archivo> > <test>" por cada fallo (el formato que
// lee rq.mjs para reconocer tests.rojos_conocidos) y un resumen. Sale con el código de node:test.
import path from 'node:path';

export default async function* reporterFallos(source) {
  let pass = 0;
  let fail = 0;
  for await (const { type, data } of source) {
    if (type === 'test:pass' && data.details?.type !== 'suite') pass += 1;
    if (type === 'test:fail' && data.details?.type !== 'suite') {
      fail += 1;
      const archivo = data.file ? path.basename(data.file) : '?';
      const err = data.details?.error;
      const msg = String(err?.cause?.message ?? err?.message ?? '').split('\n')[0];
      yield `FAIL ${archivo} > ${data.name}\n    ${msg}\n`;
    }
  }
  yield `\n# pass ${pass}\n# fail ${fail}\n`;
}
