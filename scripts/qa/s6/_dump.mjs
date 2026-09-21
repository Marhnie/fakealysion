import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const a=JSON.parse(fs.readFileSync('data/rulings/slice6.json','utf8'));
const out=[];let last=null;const cls={};
for(const x of a){const id=x.card.split(' ')[0];
 if(!S.CARDS[id]){cls[x.id]='N';continue;}
 if(id!==last){last=id;const c=S.CARDS[id];out.push(`\n## ${id} ${c.nameKo} ${c.category} Lv${c.level||''} DP${c.dp||''} cost${c.cost??''} ${(c.colors||[]).join('')}\n E:${(c.effectKo||'').replace(/\n/g,' / ')}${c.inheritedKo?'\n I:'+c.inheritedKo.replace(/\n/g,' / '):''}${c.securityKo?'\n S:'+c.securityKo.replace(/\n/g,' / '):''}`);}
 out.push(`#${x.id} Q:${x.q}\n  A:${x.a}${x.cards.length>1?' [cards:'+x.cards.map(z=>z.split(' ')[0]).join(',')+']':''}`);}
fs.writeFileSync('scripts/qa/_dump.txt',out.join('\n'));
fs.writeFileSync('scripts/qa/_cls.json',JSON.stringify(cls));
console.log(out.length, fs.statSync('scripts/qa/_dump.txt').size, Object.keys(cls).length);
