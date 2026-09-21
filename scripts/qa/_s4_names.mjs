import { S, C } from './lib-s4.mjs';
const pat = process.argv.slice(2);
for (const p of pat) { const re = new RegExp(p); const h = Object.values(C).filter(c => re.test(c.nameKo)).slice(0, 40).map(c => `${c.id}:${c.nameKo}(${c.category[0]}${c.level ?? ''})`); console.log(p, h.join(' ')); }
