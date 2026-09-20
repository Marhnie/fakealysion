// Blind-spot list from merged cpu-hunt exposure:  node scripts/cpu-hunt-blind.mjs <dir> <prefix1,prefix2,...> < /dev/null
// A card is "exercised" when it was on the field as a stack top / evolution source (digimon, tamer, digitama) or when one of its effects was queued (options).
import * as fs from 'fs';
const [dir, prefixes] = process.argv.slice(2);
const cards = JSON.parse(fs.readFileSync('data/cards_full.json', 'utf8'));
const expo = {};
let games = 0;
for (const f of fs.readdirSync(dir).filter((f) => prefixes.split(',').some((p) => f.startsWith(p)) && f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')); games += j.stats.games || 0;
  for (const [id, e] of Object.entries(j.expo)) { const x = (expo[id] ||= {}); for (const [a, b] of Object.entries(e)) x[a] = (x[a] || 0) + b; }
}
const ids = Object.keys(cards).filter((id) => !cards[id].isToken);
const cat = (id) => cards[id].category;
const exercised = (id) => { const e = expo[id] || {}; return cat(id) === 'option' ? (e.trig || 0) > 0 : (e.top || 0) > 0 || (e.src || 0) > 0; };
const never = ids.filter((id) => !exercised(id));
const dist = { '0': 0, '1-4': 0, '5-19': 0, '20+': 0 };
for (const id of ids) { const n = (expo[id] || {}).top || 0; dist[n === 0 ? '0' : n < 5 ? '1-4' : n < 20 ? '5-19' : '20+']++; }
console.log(JSON.stringify({ games, cards: ids.length, exercised: ids.length - never.length, neverExercised: never.length, topCountDist: dist }));
const byCat = {}; for (const id of never) (byCat[cat(id)] ||= []).push(id);
for (const [c, l] of Object.entries(byCat)) console.log(`never exercised ${c} (${l.length}): ${l.slice(0, 80).join(' ')}${l.length > 80 ? ' …' : ''}`);
const noTrig = ids.filter((id) => { const e = expo[id] || {}; const t = (cards[id].effectKo || '') + (cards[id].inheritedKo || ''); return (e.top || 0) >= 5 && !e.trig && /【(등장 시|진화 시|어택 시|소멸 시|메인|시큐리티|어택 종료 시)】/.test(t); });
console.log(`on field >=5 times but NEVER queued a triggered effect although text has 등장/진화/어택/소멸/메인/시큐리티 tags (${noTrig.length}): ${noTrig.slice(0, 80).join(' ')}`);
fs.writeFileSync(dir + '/blind_never.json', JSON.stringify({ never, noTrig }));
