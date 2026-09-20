import * as fs from 'fs';
import * as S from '../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
for (const id of process.argv.slice(2)) { const c = S.CARDS[id]; console.log('==', id, c.nameKo, c.category, '\n E:', c.effectKo, '\n I:', c.inheritedKo); }
