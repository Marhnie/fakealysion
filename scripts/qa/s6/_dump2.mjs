import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const a=JSON.parse(fs.readFileSync('data/rulings/slice6.json','utf8'));
const cls=JSON.parse(fs.readFileSync('scripts/qa/_cls.json','utf8'));
const groups=new Map();
for(const x of a){if(cls[x.id])continue;const k=x.q+'|'+x.a;if(!groups.has(k))groups.set(k,{x,ids:[],cards:new Set()});const g=groups.get(k);g.ids.push(x.id);for(const c of [x.card,...x.cards])g.cards.add(c.split(' ')[0]);}
const out=[];const shown=new Set();let n=0;
const G=[...groups.values()];
fs.writeFileSync('scripts/qa/_groups.json',JSON.stringify(G.map(g=>({ids:g.ids,cards:[...g.cards]}))));
for(let i=0;i<G.length;i++){const g=G[i];const id=g.x.card.split(' ')[0];
 if(!shown.has(id)&&g.ids.length<=2){shown.add(id);const c=S.CARDS[id];out.push(`\n## ${id} ${c.nameKo} ${c.category} Lv${c.level||''} DP${c.dp||''} ${(c.colors||[]).join('')}\n E:${(c.effectKo||'').replace(/\n/g,' / ')}${c.inheritedKo?'\n I:'+c.inheritedKo.replace(/\n/g,' / '):''}${c.securityKo?'\n S:'+c.securityKo.replace(/\n/g,' / '):''}`);}
 out.push(`G${i} #${g.ids.join(',')} (${g.cards.size}c) ${[...g.cards].slice(0,4).join(',')}\n Q:${g.x.q.replace(/\n/g,' ')}\n A:${g.x.a.replace(/\n/g,' ')}`);}
fs.writeFileSync('scripts/qa/_dump2.txt',out.join('\n'));
console.log(G.length, fs.statSync('scripts/qa/_dump2.txt').size);
