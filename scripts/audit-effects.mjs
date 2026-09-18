// Coverage audit: runs every card's effectKo/inheritedKo text through the
// SAME scriptFor() logic main.js uses at runtime (kept in sync manually —
// mirror any change to main.js's scriptFor here) and reports what fraction
// of printed effect segments actually produce an executable script versus
// falling back to the manual "quick apply buttons" pending-effect UI.
//
// Run: node scripts/audit-effects.mjs
// Writes uncovered.json (repo-root) with every uncovered segment for
// frequency analysis (group by normalized body text to find copy-pasted
// phrasings worth adding compiler support for next).
import fs from 'node:fs';
import * as S from '../src/state.js';
import * as Effects from '../src/effects.js';

global.fetch = async (url) => ({ json: async () => JSON.parse(fs.readFileSync(url.replace(/^\.\//, './'), 'utf8')) });
await S.loadData();

const cards = Object.values(S.CARDS);
let totalSegments = 0, compiledSegments = 0, turnConditionalHandled = 0;
const uncovered = [];
const uncoveredByTagPattern = {};

const TURN_TAGS = new Set(['자신의 턴', '상대의 턴', '서로의 턴']);

// Mirrors main.js's scriptFor().
function scriptFor(trigger) {
  const specific = Effects.lookupCardSpecific(trigger.cardId, trigger.tags);
  if (specific) return specific;
  if (/^이\s*카드의\s*【메인】\s*효과를\s*발(?:휘|동)한다\.?$/.test(trigger.text.trim())) {
    const { segments } = S.parseEffectSegments(S.card(trigger.cardId).effectKo || '');
    const mainSeg = segments.find(seg => seg.tags.includes('메인'));
    if (mainSeg) return Effects.compileToScript(mainSeg.body);
  }
  return Effects.compileToScript(trigger.text);
}

function auditText(cardId, source, text) {
  if (!text) return;
  const { segments } = S.parseEffectSegments(text);
  for (const seg of segments) {
    totalSegments++;
    // Handled live via effectiveDP's turnConditionalDP (state.js), not the
    // trigger/script pipeline — mirror that here so it isn't double-flagged.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^(?:레스트\s*상태인\s*|(?:「[^」]+」|[《≪][^》≫]+[》≫])(?:이|가)\s*기술되어\s*있는\s*)?이\s*디지몬을\s*DP\s*[+-]\s*\d+\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via S.evolveTargetRestriction, checked from canEvolveAny.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은\s*(?:(?:레드|블루|옐로우|그린|블랙|퍼플|화이트)인\s*디지몬으로만|명칭에\s*「[^」]+」\s*(?:을|를)?\s*포함하는\s*디지몬으로만|「[^」]+」(?:으로만|로만))\s*진화할\s*수\s*있다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via S.canAttackAnyActive, checked from legalDigimonTargets.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은?[,]?\s*액티브\s*상태의?\s*상대(?:의)?\s*디지몬에게도\s*어택할\s*수\s*있다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    {
      // Handled live via runBattleWinTriggers (resolveDigimonBattle) and
      // findRedirectOptions (attack flow) — embedded "~했을 때" triggers
      // nested inside a continuous turn-tag wrapper, not bracket-tagged.
      const bodyNoLimit = seg.body.trim().replace(/^\[턴\s*에?\s*\d+\s*회\]\s*/, '');
      if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && (
        /^이\s*디지몬이\s*배틀에서\s*상대(?:의)?\s*디지몬을\s*소멸시켰을\s*때,?\s*상대(?:의)?\s*시큐리티를\s*위에서부터\s*\d+\s*장\s*파기한다\.?$/.test(bodyNoLimit)
        || /^상대(?:의)?\s*디지몬이\s*어택했을\s*때,?\s*어택의?\s*대상을\s*이\s*디지몬으로\s*변경할\s*수\s*있다\.?$/.test(bodyNoLimit)
      )) {
        turnConditionalHandled++;
        continue;
      }
    }
    // Handled live via isEvoCostLocked, checked from consumeEvoCostMod.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^상대는\s*지불하는\s*진화\s*코스트를?\s*마이너스할\s*수\s*없다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via isMemoryGainLocked, checked from grantMemory.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^(?:상대|서로)는\s*테이머의?\s*효과\s*이외로\s*메모리를\s*플러스할\s*수\s*없다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    let script = [];
    try { script = scriptFor({ cardId, tags: seg.tags, text: seg.body }); } catch (e) { script = []; }
    if (script && script.length) {
      compiledSegments++;
    } else {
      uncovered.push({ cardId, source, tags: seg.tags, body: seg.body });
      const key = seg.tags.join('|');
      uncoveredByTagPattern[key] = (uncoveredByTagPattern[key] || 0) + 1;
    }
  }
}

for (const c of cards) {
  auditText(c.id, 'effectKo', c.effectKo);
  auditText(c.id, 'inheritedKo', c.inheritedKo);
}

console.log(JSON.stringify({ totalSegments, compiledSegments, turnConditionalHandled, uncoveredCount: uncovered.length,
  coveragePct: (((compiledSegments + turnConditionalHandled) / totalSegments) * 100).toFixed(1) + '%' }, null, 2));

console.log('\n--- uncovered by trigger-tag pattern (top 20) ---');
for (const [k, v] of Object.entries(uncoveredByTagPattern).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(v, k);

fs.writeFileSync('./uncovered.json', JSON.stringify(uncovered, null, 2));
console.log('\nwrote', uncovered.length, 'uncovered entries to uncovered.json');
