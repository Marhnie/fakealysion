import * as fs from 'fs';
import * as S from '../src/state.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
for (const t of process.argv.slice(2)) console.log(JSON.stringify(t), '=>', JSON.stringify(Fx.compileToScript(t)));
