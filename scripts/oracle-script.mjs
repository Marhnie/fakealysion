// Show the compiled / bespoke script for a printed effect text:  node scripts/oracle-script.mjs <cardId> "<tag>" "<text>" < /dev/null
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const [id, tag, text] = process.argv.slice(2);
const sp = Fx.lookupCardSpecific(id, [tag], text);
console.log('bespoke:', !!sp);
console.log(JSON.stringify(sp || Fx.compileToScript(text), (k, v) => (typeof v === 'function' ? '[fn]' : v), 1));
