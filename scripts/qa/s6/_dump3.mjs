import * as fs from 'fs';
import * as S from '../../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url, 'utf8')) });
await S.loadData();
const a=JSON.parse(fs.readFileSync('data/rulings/slice6.json','utf8'));
const byId=new Map(a.map(x=>[x.id,x]));
const G=JSON.parse(fs.readFileSync('scripts/qa/s6/_groups.json','utf8'));
const cls=JSON.parse(fs.readFileSync('docs/qa-slice6-classification.json','utf8'));
const unb="2,13,14,18,23,25,26,31,32,33,35,36,39,46,47,52,54,56,59,60,65,68,69,70,73,74,75,76,77,78,81,82,83,84,85,86,87,88,89,92,96,97,98,99,104,105,106,107,112,113,114,115,116,117,120,121,123,124,125,126,127,128,129,130,131,132,133,139,140,142,143,144,145,149,151,153,154,157,158,161,163,164,167,168,170,174,183,184,185,189,190,191,192,193,195,196,199,202,203,204,206,207,220,221,223,224,227,228,229,230,231,232,233,235,236,237,239,240,241,243,248,249,250,253,257,260,262,263,264,265,266,267,268,270,272,276,280,281,282,283,285,286,287,290,295,296,297,298,300,301,302,303,306,308,309,312,313,314,315,317,318,319,320,322,323,324,325,328,329,330,331,335,336,337,338,339,340,342".split(',').map(Number);
const seen=new Set();let out=[];
for(const g of unb){const gr=G[g];const x=byId.get(gr.ids[0]);const T=gr.ids.filter(i=>cls[i]==='T');
 let s=`\n### G${g} T-ids=${T.length}/${gr.ids.length} [${T.slice(0,8).join(',')}] cards:${gr.cards.slice(0,6).join(',')}\nQ:${x.q.replace(/\n/g,' ')}\nA:${x.a.replace(/\n/g,' ')}`;
 for(const cid of gr.cards.slice(0,3)){ if(seen.has(cid))continue;seen.add(cid);const c=S.CARDS[cid];if(!c){continue;} s+=`\n  [${cid} ${c.nameKo} ${c.category} Lv${c.level||''} DP${c.dp||''} cost${c.cost??''} ${(c.colors||[]).join('')}] E:${(c.effectKo||'').replace(/\n/g,' / ')}${c.inheritedKo?' I:'+c.inheritedKo.replace(/\n/g,' / '):''}${c.securityKo?' S:'+c.securityKo.replace(/\n/g,' / '):''}`;}
 out.push(s);}
fs.writeFileSync(process.argv[2],out.join('\n'));console.log(out.length,out.join('\n').length);
