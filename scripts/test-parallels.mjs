// Parallel-art variants: data integrity, deck art choices, art lookup. Run: node scripts/test-parallels.mjs (from repo root)
import * as fs from 'fs';
import * as S from '../src/state.js';
import * as DB from '../src/deckbuilder.js';
import * as DBS from '../src/dbsearch.js';
global.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync(u, 'utf8')) });
await S.loadData();
const keys=new Set();let n=0;
for(const [no,arr] of Object.entries(S.PARALLELS)) for(const v of arr){ n++; if(keys.has(v.key)) throw 'dup'; keys.add(v.key); if(!S.CARDS[no]) throw 'nobase '+no; if(!v.key.startsWith(no+'_P')) throw 'key'; }
console.log('variants',n);
const ids=Object.keys(S.PARALLELS).filter(i=>S.CARDS[i].category==='digimon');
const d={name:'x',main:{},digitama:{},art:{}}; d.main[ids[0]]=4; d.main[ids[1]]=4; d.main[ids[2]]=42;
const before=S.deckLegality(d); DB.setArt(d,ids[0],S.PARALLELS[ids[0]][0].key);
console.log(JSON.stringify(before)===JSON.stringify(S.deckLegality(d)), JSON.stringify(DB.toDeckDefRecord(d).art));
const g=S.newGame(DB.toDeckDefRecord(d),DB.toDeckDefRecord(d)); 
console.log(S.artUrl(g,'p1',ids[0])===S.PARALLELS[ids[0]][0].imgUrl, S.artUrl(g,'p1',ids[1])===S.CARDS[ids[1]].imgUrl, S.artUrl(null,null,ids[0])===S.CARDS[ids[0]].imgUrl);
const ix=DBS.buildIndex(S.CARDS,S.PARALLELS); const f=DBS.defaultFilter(); f.hasPar=true; console.log(DBS.runSearch(f,S.CARDS,ix).ids.length);
f.hasPar=false; f.rarities=['SEC']; console.log(DBS.runSearch(f,S.CARDS,ix).ids.length);
