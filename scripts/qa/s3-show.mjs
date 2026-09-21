import * as fs from 'fs';
import * as S from '../../src/state.js';
global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();
const qa = JSON.parse(fs.readFileSync('data/rulings/slice3.json','utf8'));
const [a,b]=process.argv.slice(2).map(Number);
const seen=new Map(); qa.slice(0,a).forEach(q=>{const k=q.q.replace(/「[^」]*」/g,'').trim();if(!seen.has(k))seen.set(k,q.id)});
let last='';
for (const q of qa.slice(a,b)){
  const k=q.q.replace(/「[^」]*」/g,'').trim();
  if(seen.has(k)){ console.log('Q'+q.id+' ('+q.card.split(' ')[0]+') = dup of Q'+seen.get(k)); continue;}
  seen.set(k,q.id);
  const key=q.cards.join('|');
  if(key!==last){ last=key; console.log('\n## '+q.card+(q.cards.length>1?' +'+q.cards.slice(1).map(x=>x.split(' ')[0]).join(','):''));
    for(const cid of [...new Set(q.cards.map(c=>c.split(' ')[0]))].slice(0,3)){const c=S.CARDS[cid]; if(!c)continue; const t=(c.effectKo||'')+(c.inheritedKo?' ||INH: '+c.inheritedKo:''); console.log(' ['+cid+' '+c.nameKo+' '+c.category+' Lv'+c.level+' c'+c.cost+' dp'+c.dp+'] '+t.replace(/\s+/g,' ').slice(0,140));}
  }
  console.log('Q'+q.id+': '+q.q.replace(/\s+/g,' ').slice(0,120)+'\n  A: '+q.a.replace(/\s+/g,' ').slice(0,80));
}
