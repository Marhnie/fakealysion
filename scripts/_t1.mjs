import * as fs from 'fs';
import * as S from '../src/state.js';
import * as Fx from '../src/effects.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const c=S.CARDS['BT20-102'];
console.log(Object.keys(Fx));
for (const t of c.effectKo.split('\n')) { if(!t.startsWith('【'))continue; console.log('---',t.slice(0,40)); try{console.log(JSON.stringify(Fx.compileToScript(t)));}catch(e){console.log('ERR',e.message)} }
