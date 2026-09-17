import { readFileSync } from 'node:fs';
import { parseEffectSegments } from '../src/state.js';
import { compileToScript, lookupCardSpecific } from '../src/effects.js';

const prefix = process.argv[2] || 'BT1-';
const cards = JSON.parse(readFileSync(new URL('../data/cards_full.json', import.meta.url), 'utf-8'));
const bt1 = Object.values(cards).filter(c => c.id.startsWith(prefix));

const allTags = new Set();
let totalSegments = 0, autoApplyWhole = 0, scriptedSome = 0, unrecognized = 0;
const unrecognizedList = [];

// mirror the whole-match check from state.js (kept in sync manually for analysis)
function wholeMatch(t) {
  const s = t.replace(/[≪《》≫]/g, '').trim();
  return [
    /^(\d+)\s*드로우(?:한다)?[.。]?$/,
    /^메모리\s*\+\s*(\d+)(?:한다)?[.。]?$/,
    /^메모리\s*-\s*(\d+)(?:한다)?[.。]?$/,
    /^(?:자신의\s*)?덱\s*위(?:에서)?(?:\s*부터)?\s*(\d+)\s*장(?:을)?\s*파기(?:한다|할\s*수\s*있다)?[.。]?$/,
    /^상대(?:의)?\s*덱\s*위(?:에서)?(?:\s*부터)?\s*(\d+)\s*장(?:을)?\s*파기(?:한다|할\s*수\s*있다)?[.。]?$/,
    /^(?:자신의\s*)?패(?:를)?\s*전부\s*파기(?:한다)?[.。]?$/,
  ].some(re => re.test(s));
}

for (const c of bt1) {
  if (!c.effectKo) continue;
  const { segments } = parseEffectSegments(c.effectKo);
  for (const seg of segments) {
    seg.tags.forEach(t => allTags.add(t));
    totalSegments++;
    if (wholeMatch(seg.body)) { autoApplyWhole++; continue; }
    const specific = lookupCardSpecific(c.id, seg.tags);
    if (specific) { scriptedSome++; continue; }
    const script = compileToScript(seg.body);
    if (script.length > 0) { scriptedSome++; continue; }
    unrecognized++;
    unrecognizedList.push({ id: c.id, name: c.nameKo, tags: seg.tags, body: seg.body });
  }
  // also inspect inheritedKo (evolution-source effects) — not currently triggered by any event, worth seeing what's there
}

console.log('Total cards with effect text:', bt1.filter(c=>c.effectKo).length);
console.log('All trigger tags seen:', [...allTags].join(' | '));
console.log('Segments total:', totalSegments, 'autoApplyWhole:', autoApplyWhole, 'scriptedSome:', scriptedSome, 'unrecognized:', unrecognized);
console.log('\n--- Unrecognized segments ---');
for (const u of unrecognizedList) console.log(`${u.id} ${u.name} 【${u.tags.join('】【')}】 ${u.body}`);
