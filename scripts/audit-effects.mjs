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
  const specific = Effects.lookupCardSpecific(trigger.cardId, trigger.tags, trigger.text);
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
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은\s*(?:(?:레드|블루|옐로(?:우)?|그린|블랙|퍼플|화이트)인\s*디지몬으로만|명칭에\s*「[^」]+」\s*(?:을|를)?\s*포함하는\s*디지몬으로만|「[^」]+」(?:으로만|로만))\s*진화할\s*수\s*있다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은\s*진화할\s*수\s*없다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via hasContinuousKeyword, checked from enterBlockCheck —
    // scoped to 충돌 specifically, the only keyword anything actually
    // consumes via hasContinuousKeyword right now.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^(?:이\s*디지몬은|특징으로\s*「[^」]+」\s*(?:을|를)?\s*가진\s*이\s*디지몬은)\s*[≪《]\s*충돌\s*[≫》](?:\s*\([^()]*\))?\s*(?:을|를)?\s*얻는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via continuousEvoCostDiscount, checked at digivolve-cost time.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && S.isHandledEvoDiscountBody(seg.body)) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via tamerPlayCostDiscount, checked at fresh-play-cost time.
    if (seg.tags.length === 1 && seg.tags[0] === '자신의 턴' && /^자신(?:의)?\s*패에서\s*특징\s*「[^」]+」\s*(?:을|를)?\s*가진\s*디지몬\s*카드가\s*등장할\s*때,?\s*이\s*테이머를\s*레스트시키는\s*것으로,?\s*지불하는\s*코스트\s*-\d+\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via traitPlayCostDiscount, checked at fresh-play-cost time.
    if (seg.tags.length === 1 && seg.tags[0] === '자신의 턴' && /^[\[〔]턴\s*\d+\s*회[\]〕]\s*특징\s*「[^」]+」\s*(?:을|를)?\s*가진\s*디지몬\s*카드가\s*등장할\s*때,?\s*지불하는\s*코스트\s*-\d+\s*할\s*수\s*있다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via parseDelayEffect/discardForDelay — a NEW interactive
    // "discard this placed card from the battle area to run its listed
    // effect" mechanic (16-17 ≪딜레이≫), routed through a dedicated UI
    // button rather than the normal queueTriggersFor('use') pipeline (which
    // would incorrectly let it fire immediately on use instead of only
    // later, from the battle area, after the placement turn).
    if (seg.tags.includes('메인') && /^[≪《]\s*딜레이\s*[≫》](?:\s*\([^()]*\))?(?:\s|$)/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via dpDestroyCapBoost, checked from the 'destroy' op.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^(?:자신이?\s*발휘하는|이\s*디지몬의)\s*DP\s*소멸\s*효과의?\s*상한\s*\+\d+\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via dpDestroyCapBoost's stackUid-scoped, memory-gated branch.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^메모리가\s*-?\d+\s*이하인\s*동안,?\s*이\s*디지몬의\s*DP\s*소멸\s*효과의?\s*상한\s*\+\d+\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via S.canAttackAnyActive, checked from legalDigimonTargets.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은?[,]?\s*액티브\s*상태(?:의|인)?\s*상대(?:의)?\s*디지몬에게도\s*어택할\s*수\s*있다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    {
      // Handled live via runBattleWinTriggers (resolveDigimonBattle) and
      // findRedirectOptions (attack flow) — embedded "~했을 때" triggers
      // nested inside a continuous turn-tag wrapper, not bracket-tagged.
      const bodyNoLimit = seg.body.trim().replace(/^[\[〔]턴\s*에?\s*\d+\s*회[\]〕]\s*/, '');
      if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && (
        /^이\s*디지몬이\s*배틀에서\s*상대(?:의)?\s*디지몬을\s*소멸시켰을\s*때,?\s*상대(?:의)?\s*시큐리티를\s*위에서부터\s*\d+\s*장\s*파기한다\.?$/.test(bodyNoLimit)
        || S.isHandledRedirectBody(seg.body)
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
    // Handled live via stackHasContinuousAbility in legalDigimonTargets/declareAttack.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && (
      /^이\s*디지몬은\s*상대(?:의)?\s*디지몬에게\s*어택할\s*수\s*없다\.?$/.test(seg.body.trim())
      || /^이\s*디지몬은\s*어택당하지\s*않는다\.?$/.test(seg.body.trim())
      || /^상대(?:의)?\s*디지몬이\s*없는\s*동안,?\s*이\s*디지몬은\s*어택할\s*수\s*없다\.?$/.test(seg.body.trim()))) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via trySurviveByPrintedAbility / hasContinuousKeyword (deleteStack).
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && (S.isHandledSurviveBody(seg.body) || S.isHandledContinuousKeywordBody(seg.body))) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via emitGameEvent/parseWatcherTrigger ("~했을 때" watchers in 자신/상대/서로의 턴).
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && S.isHandledWatcherBody(seg.body)) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via isPlayCostLocked, checked from tamerPlayCostDiscount.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^서로는\s*지불하는\s*등장\s*코스트를?\s*마이너스할\s*수\s*없다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via isMemoryGainLocked, checked from grantMemory.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^(?:상대|서로)는\s*테이머의?\s*효과\s*이외로\s*메모리를\s*플러스할\s*수\s*없다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via trySurviveBySacrifice, checked from deleteStack.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬이\s*소멸할\s*때,?\s*명칭에\s*「[^」]+」\s*(?:을|를)?\s*포함하는\s*다른\s*디지몬\s*\d+\s*마리를?\s*소멸시키는\s*것으로,?\s*소멸하지\s*않는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via fullEffectInheritTarget, checked from
    // stackContributors/queueTriggersForStack.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은\s*이\s*디지몬의\s*진화원에\s*있는\s*(?:명칭에\s*)?「[^」]+」\s*(?:을|를)?\s*(?:포함하는\s*카드)?의\s*효과\s*전부를\s*얻는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via isAttackTargetImmune, checked from findRedirectOptions.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬의?\s*어택(?:의)?\s*대상은\s*변경되지\s*않는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via isAttackPlayerRestrictedByAbility, checked from canAttackPlayer.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은\s*플레이어에게\s*어택할\s*수\s*없다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via cannotBeBlockedBy, checked from enterBlockCheck.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은[,]?\s*(?:진화원을?\s*갖지\s*않은\s*)?상대(?:의)?\s*디지몬에게는\s*블록당하지\s*않는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^이\s*디지몬은\s*블록당하지\s*않는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Handled live via isPreventedFromUnsuspending, checked from nextPhase.
    if (seg.tags.length === 1 && TURN_TAGS.has(seg.tags[0]) && /^상대(?:의)?\s*테이머\s*전부는\s*(?:액티브\s*페이즈에서는\s*)?액티브가\s*되지\s*않는다\.?$/.test(seg.body.trim())) {
      turnConditionalHandled++;
      continue;
    }
    // Bespoke continuous/replacement hooks registered by a shard (state.js hookDescriptorFor). Event-driven hooks
    // (descriptor.events) still need their SCRIPTS entry below, so only purely continuous ones are skipped here.
    {
      const hd = S.hookDescriptorFor(cardId, seg.tags, seg.body);
      if (hd && (!hd.events || hd.selfContained)) { turnConditionalHandled++; continue; }
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
  if (c.optionKo) auditText(c.id, 'optionKo', S.optionView(c.id).effectKo); // dual cards' option half
}

console.log(JSON.stringify({ totalSegments, compiledSegments, turnConditionalHandled, uncoveredCount: uncovered.length,
  coveragePct: (((compiledSegments + turnConditionalHandled) / totalSegments) * 100).toFixed(1) + '%' }, null, 2));

console.log('\n--- uncovered by trigger-tag pattern (top 20) ---');
for (const [k, v] of Object.entries(uncoveredByTagPattern).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(v, k);

fs.writeFileSync('./uncovered.json', JSON.stringify(uncovered, null, 2));
console.log('\nwrote', uncovered.length, 'uncovered entries to uncovered.json');
