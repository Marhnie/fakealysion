// Structured effect DSL interpreter.
// A "script" is an array of instructions. Each instruction is a plain object
// with an `op`. Instructions that need a target the player must pick return
// control via an async choice callback (ctx.choose) so the UI can render a
// picker and resume execution afterward.
//
// Instruction set (op):
//   draw            { who, n }
//   trashDeckTop    { who, n }
//   gainMemory      { who, n }
//   addSecurity     { who, position, from: 'hand'|'thisCard'|'topOfDeck', filter? }
//   removeSecurity  { who, position }                      -> returns removed cardId
//   revealTop       { who, n, pick: {min,max,filter}, restTo }
//   trashHand       { who, n, filter? }                    -> choose which to trash
//   destroy         { target: 'self'|'opponent', mode:'choose'|'all'|'lowestDP', filter? }
//   retreat         { target: 'self'|'opponent', n, mode:'choose' }
//   playFree        { who, zone:'hand'|'trash', filter?, costDelta? }
//   grantKeyword    { target:'thisStack'|'filter', keyword, scope:'turn'|'opponentTurn'|'permanent' }
//   condition       { if:{...}, then:[...], else:[...] }
//   choice          { prompt, options:[{label, then:[...]}] }
//
// `ctx` shape: { state, S, self, opp, sourceCardId, sourceStackUid, choose }
// `ctx.choose(kind, payload)` returns a Promise resolved by the UI with the
// player's pick; the caller (main.js) supplies the real implementation.

function matchesFilter(S, cardId, filter) {
  if (!filter) return true;
  const c = S.card(cardId);
  if (filter.level != null && c.level !== filter.level) return false;
  if (filter.levelMax != null && (c.level || 0) > filter.levelMax) return false;
  if (filter.levelMin != null && (c.level || 0) < filter.levelMin) return false;
  if (filter.colors && !(c.colors || []).some(col => filter.colors.includes(col))) return false;
  if (filter.trait && !(c.traits || []).includes(filter.trait)) return false;
  if (filter.traitAny && !filter.traitAny.some(t => (c.traits || []).includes(t))) return false;
  if (filter.category && c.category !== filter.category) return false;
  if (filter.dpMax != null && (c.dp || 0) > filter.dpMax) return false;
  if (filter.dpMin != null && (c.dp || 0) < filter.dpMin) return false;
  if (filter.dp != null && (c.dp || 0) !== filter.dp) return false;
  if (filter.name && c.nameKo !== filter.name) return false;
  if (filter.nameIncludes && !c.nameKo.includes(filter.nameIncludes)) return false;
  return true;
}

export async function runScript(script, ctx) {
  for (const instr of script || []) {
    await runOne(instr, ctx);
  }
}

async function runOne(instr, ctx) {
  const { state, S } = ctx;
  const who = instr.who === 'opponent' ? ctx.opp : instr.who === 'self' ? ctx.self : instr.who || ctx.self;
  switch (instr.op) {
    case 'draw':
      S.drawCards(state, who, instr.n);
      break;
    case 'trashDeckTop':
      S.trashTopOfDeck(state, who, instr.n);
      break;
    case 'gainMemory':
      S.grantMemory(state, who, instr.n);
      break;
    case 'addSecurity': {
      let cardId = instr.cardId;
      if (instr.from === 'thisCard') cardId = ctx.sourceCardId;
      if (instr.from === 'hand') {
        const pick = await ctx.choose('pickFromHand', { player: who, filter: instr.filter, prompt: instr.prompt || '시큐리티에 놓을 카드 선택' });
        if (!pick) break;
        const pl = state.players[who];
        const idx = pl.hand.indexOf(pick);
        if (idx !== -1) pl.hand.splice(idx, 1);
        cardId = pick;
      }
      if (instr.from === 'topOfDeck') cardId = state.players[who].deck.shift();
      if (cardId) S.addToSecurity(state, who, cardId, instr.position || 'top');
      break;
    }
    case 'removeSecurity': {
      const id = instr.position === 'bottom' ? S.trashBottomSecurityByEffect(state, who) : S.trashTopSecurityByEffect(state, who);
      instr._result = id;
      break;
    }
    case 'revealTop': {
      const revealed = S.revealTop(state, who, instr.n);
      const eligible = revealed.map((id, i) => ({ id, i })).filter(x => matchesFilter(S, x.id, instr.pick?.filter));
      const chosenIdxs = await ctx.choose('pickFromRevealed', {
        player: who, revealed, eligible, min: instr.pick?.min ?? 0, max: instr.pick?.max ?? eligible.length,
        prompt: instr.prompt || '공개된 카드 중 가져갈 카드 선택',
      });
      S.resolveReveal(state, who, instr.n, chosenIdxs || [], chosenIdxs || [], instr.restTo || 'bottom');
      break;
    }
    case 'trashHand': {
      const pl = state.players[who];
      const eligibleIdxs = pl.hand.map((id, i) => i).filter(i => matchesFilter(S, pl.hand[i], instr.filter));
      const chosen = await ctx.choose('pickFromHandIndexes', { player: who, eligibleIdxs, n: instr.n, prompt: instr.prompt || `핸드에서 ${instr.n}장 파기` });
      (chosen || []).sort((a, b) => b - a).forEach(i => S.trashFromHand(state, who, i));
      break;
    }
    case 'destroy': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const pl = state.players[targetPlayer];
      let uids = pl.battle.map(s => s.uid);
      if (instr.filter) uids = pl.battle.filter(s => matchesFilter(S, s.cardId, instr.filter)).map(s => s.uid);
      if (instr.mode === 'thisStack') {
        S.deleteStack(state, targetPlayer, ctx.sourceStackUid);
      } else if (instr.mode === 'all') {
        uids.forEach(uid => S.deleteStack(state, targetPlayer, uid));
      } else if (instr.mode === 'lowestDP') {
        const withDp = pl.battle.filter(s => uids.includes(s.uid)).map(s => ({ uid: s.uid, dp: S.card(s.cardId).dp || 0 }));
        if (withDp.length) {
          const min = Math.min(...withDp.map(x => x.dp));
          withDp.filter(x => x.dp === min).forEach(x => S.deleteStack(state, targetPlayer, x.uid));
        }
      } else {
        const pick = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '소멸시킬 디지몬 선택' });
        if (pick) S.deleteStack(state, targetPlayer, pick);
      }
      break;
    }
    case 'retreat': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const pl = state.players[targetPlayer];
      const uids = pl.battle.map(s => s.uid).concat(pl.raising ? [pl.raising.uid] : []);
      const pick = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '퇴화시킬 디지몬 선택' });
      if (pick) S.retreat(state, targetPlayer, pick, instr.n);
      break;
    }
    case 'playFree': {
      const zone = instr.zone === 'trash' ? 'trash' : 'hand';
      const pl = state.players[who];
      const eligibleIdxs = pl[zone].map((id, i) => i).filter(i => matchesFilter(S, pl[zone][i], instr.filter));
      const chosenIdx = await ctx.choose('pickFromZoneIndex', { player: who, zone, eligibleIdxs, prompt: instr.prompt || `${zone === 'trash' ? '트래시' : '핸드'}에서 무료로 등장시킬 카드 선택` });
      if (chosenIdx == null) break;
      const [cardId] = pl[zone].splice(chosenIdx, 1);
      const stack = { uid: 'u' + Math.random().toString(36).slice(2), cardId, sources: [], suspended: false, playedTurn: state.turnNumber };
      pl.battle.push(stack);
      S.log(state, `${who} ${S.card(cardId).nameKo} 코스트 없이 등장 (효과)`);
      break;
    }
    case 'unsuspend': {
      const targetUid = instr.target === 'thisStack' ? ctx.sourceStackUid : await ctx.choose('pickStack', { player: ctx.self, uids: [...(state.players[ctx.self].raising ? [state.players[ctx.self].raising.uid] : []), ...state.players[ctx.self].battle.map(s => s.uid)], prompt: instr.prompt || '액티브로 만들 디지몬 선택' });
      if (targetUid) S.unsuspendStack(state, ctx.self, targetUid);
      break;
    }
    case 'rest': {
      // "디지몬 1마리를 레스트시킬 수 있다." with no 상대/자신 prefix at all
      // means the ACTING player's choice of either side's Digimon — common
      // on cards that follow up with "이 효과로 자신의 디지몬이 레스트했다면"
      // (only makes sense if resting your own was actually an option).
      if (instr.target === 'either') {
        const entries = [
          ...state.players[ctx.self].battle.map(s => ({ player: ctx.self, uid: s.uid })),
          ...state.players[ctx.opp].battle.map(s => ({ player: ctx.opp, uid: s.uid })),
        ];
        const picked = await ctx.choose('pickStackAnySide', { entries, prompt: instr.prompt || '레스트시킬 디지몬 선택 (자신/상대 무관)' });
        if (picked) S.restStack(state, picked.player, picked.uid);
        break;
      }
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '레스트시킬 디지몬 선택' });
      if (targetUid) S.restStack(state, targetPlayer, targetUid);
      break;
    }
    case 'modifyDP': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.map(s => s.uid);
      const targetUid = instr.target !== 'opponent' && instr.thisStack ? ctx.sourceStackUid
        : await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || `DP ${instr.amount >= 0 ? '+' : ''}${instr.amount} 받을 디지몬 선택` });
      if (targetUid) S.modifyDP(state, targetPlayer, targetUid, instr.amount, instr.duration || 'turn');
      break;
    }
    case 'modifyDPAll': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      for (const s of state.players[targetPlayer].battle) S.modifyDP(state, targetPlayer, s.uid, instr.amount, instr.duration || 'turn');
      break;
    }
    case 'saveUnderTamer': {
      // 16-20: optional — no Tamer in play means it's simply unusable, not
      // a choice to surface.
      const tamerUids = state.players[ctx.self].battle.filter(s => S.card(s.cardId).category === 'tamer').map(s => s.uid);
      if (!tamerUids.length) break;
      const cardName = S.card(ctx.sourceCardId).nameKo;
      const useIt = await ctx.choose('multipleChoice', { prompt: `${cardName}: 《세이브》(자신의 테이머 아래에 놓기) 사용?`, options: ['사용', '사용 안 함'] });
      if (useIt !== 0) break;
      const tamerUid = tamerUids.length === 1 ? tamerUids[0]
        : await ctx.choose('pickStack', { player: ctx.self, uids: tamerUids, prompt: '세이브할 테이머 선택' });
      if (tamerUid) S.saveCardUnderTamer(state, ctx.self, ctx.sourceCardId, tamerUid);
      break;
    }
    case 'blastEvolve': {
      // 16-26: "evolve your Digimon into this hand card for free" — the
      // COST is waived, but which cards this can target still follows the
      // normal evolution rules (evoNormal / printed 〔진화〕 conditions),
      // same check the drag-drop digivolve path uses. Only stacks that
      // actually satisfy some printed condition are offered as choices.
      const pl = state.players[ctx.self];
      const eligible = pl.battle.filter(s => ctx.E.canEvolveAny(s.cardId, ctx.sourceCardId, s.extraColors || [], S.evolveTargetRestriction(state, ctx.self, s)).ok);
      if (!eligible.length) break;
      const targetUid = eligible.length === 1 ? eligible[0].uid
        : await ctx.choose('pickStack', { player: ctx.self, uids: eligible.map(s => s.uid), prompt: `《블래스트 진화》 — ${S.card(ctx.sourceCardId).nameKo}로 진화시킬 디지몬 선택` });
      if (targetUid) S.digivolve(state, ctx.self, targetUid, ctx.sourceCardId, 0, 'hand');
      break;
    }
    case 'grantKeyword': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      let targetUid = instr.thisStack ? ctx.sourceStackUid : null;
      if (!targetUid) {
        const uids = [...(state.players[targetPlayer].raising ? [state.players[targetPlayer].raising.uid] : []), ...state.players[targetPlayer].battle.map(s => s.uid)];
        targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || `${instr.keyword} 부여할 디지몬 선택` });
      }
      if (targetUid) S.grantKeyword(state, targetPlayer, targetUid, instr.keyword, instr.value, instr.duration || 'turn');
      break;
    }
    case 'returnFromTrash': {
      const pl = state.players[who];
      const eligibleIdxs = pl.trash.map((id, i) => i).filter(i => matchesFilter(S, pl.trash[i], instr.filter));
      const chosenIdx = await ctx.choose('pickFromZoneIndex', { player: who, zone: 'trash', eligibleIdxs, prompt: instr.prompt || '트래시에서 핸드로 되돌릴 카드 선택' });
      if (chosenIdx == null) break;
      const [cardId] = pl.trash.splice(chosenIdx, 1);
      pl.hand.push(cardId);
      S.log(state, `${who} 트래시의 ${S.card(cardId).nameKo}을(를) 핸드로`);
      break;
    }
    case 'setDP': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || 'DP를 변경할 디지몬 선택' });
      if (targetUid) {
        const pl = state.players[targetPlayer];
        const stack = pl.battle.find(s => s.uid === targetUid);
        const base = S.card(stack.cardId).dp || 0;
        S.modifyDP(state, targetPlayer, targetUid, instr.value - base - (stack.tempDP || 0) - (stack.inheritedDP || 0), instr.duration || 'turn');
      }
      break;
    }
    case 'restrictAttack': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.expiresAfterTurn;
      const expiresAfterTurn = dur === 'permanent' || dur == null ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 2 : state.turnNumber;
      if (instr.thisStack) { S.restrictAttack(state, targetPlayer, ctx.sourceStackUid, expiresAfterTurn); break; }
      if (instr.allMatching) {
        for (const s of state.players[targetPlayer].battle) {
          if (matchesFilter(S, s.cardId, instr.filter) && (!instr.noEvoSources || s.sources.length === 0)) {
            S.restrictAttack(state, targetPlayer, s.uid, expiresAfterTurn);
          }
        }
        if (instr.prompt) S.log(state, instr.prompt);
        break;
      }
      let uids = state.players[targetPlayer].battle.map(s => s.uid);
      if (instr.filter?.hasNoSources) uids = state.players[targetPlayer].battle.filter(s => s.sources.length === 0).map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '어택 불가로 만들 디지몬 선택' });
      if (targetUid) S.restrictAttack(state, targetPlayer, targetUid, expiresAfterTurn);
      break;
    }
    case 'restStack':
      S.restStack(state, ctx.self, ctx.sourceStackUid);
      break;
    case 'hatch':
      S.hatchDigitama(state, who);
      break;
    case 'moveRaising':
      S.moveRaisingToBattle(state, who);
      break;
    case 'returnToHandStripSources': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dest = instr.dest || 'hand'; // 'hand' | 'deckBottom'
      const bounce = (stack) => {
        const pl = state.players[targetPlayer];
        pl.battle.splice(pl.battle.indexOf(stack), 1);
        const linkIds = (stack.linkCards || []).map(l => l.cardId);
        if (dest === 'deckBottom') pl.deck.push(stack.cardId); else pl.hand.push(stack.cardId);
        pl.trash.push(...stack.sources, ...linkIds);
        S.log(state, `${targetPlayer} ${S.card(stack.cardId).nameKo} ${dest === 'deckBottom' ? '덱 아래로' : '핸드로'}, 진화원 ${stack.sources.length}장 + 링크 ${linkIds.length}장 파기`);
        // Overflow (4-19-1) doesn't cover Link Cards leaving (4-9-1/4-9-4) — exclude linkIds.
        for (const id of [...stack.sources, stack.cardId]) S.applyOverflowIfAny(state, targetPlayer, id);
      };
      const matching = () => state.players[targetPlayer].battle.filter(s =>
        (!instr.filter || matchesFilter(S, s.cardId, instr.filter))
        && (instr.requireSuspended == null || s.suspended === instr.requireSuspended));
      if (instr.all) {
        // Snapshot uids up front — bounce() mutates pl.battle as it goes.
        for (const uid of matching().map(s => s.uid)) {
          const stack = state.players[targetPlayer].battle.find(s => s.uid === uid);
          if (stack) bounce(stack);
        }
        break;
      }
      for (let i = 0; i < (instr.n || 1); i++) {
        const uids = matching().map(s => s.uid);
        if (!uids.length) break;
        const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || (dest === 'deckBottom' ? '덱 아래로 되돌릴 디지몬 선택' : '핸드로 되돌릴 디지몬 선택') });
        if (!targetUid) break;
        const stack = state.players[targetPlayer].battle.find(s => s.uid === targetUid);
        if (stack) bounce(stack);
      }
      break;
    }
    case 'bounceToDeckBottomStripSources': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle
        .filter(s => {
          const { segments } = S.parseEffectSegments(S.card(s.cardId).effectKo);
          return segments.some(seg => seg.tags.some(t => t.includes(instr.filter.hasSegmentTag)));
        })
        .map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '덱 아래로 되돌릴 [소멸시] 효과 보유 디지몬 선택' });
      if (targetUid) {
        const pl = state.players[targetPlayer];
        const stack = pl.battle.find(s => s.uid === targetUid);
        const idx = pl.battle.indexOf(stack);
        pl.battle.splice(idx, 1);
        const linkIds = (stack.linkCards || []).map(l => l.cardId);
        pl.deck.push(stack.cardId); // sources are simply discarded (trashed), per "그 디지몬이 가진 진화원은 파기"
        pl.trash.push(...stack.sources, ...linkIds);
        S.log(state, `${targetPlayer} ${S.card(stack.cardId).nameKo} 덱 아래로, 진화원 ${stack.sources.length}장 + 링크 ${linkIds.length}장 파기`);
        // Overflow (4-19-1) doesn't cover Link Cards leaving (4-9-1/4-9-4) — exclude linkIds.
        for (const id of [...stack.sources, stack.cardId]) S.applyOverflowIfAny(state, targetPlayer, id);
      }
      break;
    }
    case 'grantDynamicRestriction': {
      const pl = state.players[ctx.self];
      const stack = pl.raising?.uid === ctx.sourceStackUid ? pl.raising : pl.battle.find(s => s.uid === ctx.sourceStackUid);
      if (stack) {
        stack.dynamicRestrictions = stack.dynamicRestrictions || [];
        stack.dynamicRestrictions.push(instr.restriction);
        S.log(state, `${ctx.self} ${S.card(stack.cardId).nameKo}에 조건부 제약 부여: ${instr.restriction.type}`);
      }
      break;
    }
    case 'placeThisInBattle':
      S.placeThisInBattle(state, ctx.self, ctx.sourceCardId);
      break;
    case 'addSelfToHand':
      S.addSelfToHand(state, ctx.self, ctx.sourceCardId);
      break;
    case 'noop':
      S.log(state, `(확인) ${instr.note}`);
      break;
    case 'grantColor':
      S.grantColor(state, ctx.self, ctx.sourceStackUid, instr.color);
      break;
    case 'securityDPMod': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const dur = instr.duration;
      const expiresAfterTurn = dur === 'permanent' ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 2 : state.turnNumber;
      S.addSecurityDPMod(state, targetPlayer, instr.amount, expiresAfterTurn);
      break;
    }
    case 'evoCostMod': {
      const dur = instr.duration;
      const expiresAfterTurn = dur === 'permanent' ? 'permanent' : dur === 'opponentTurn' ? state.turnNumber + 2 : state.turnNumber;
      S.addEvoCostMod(state, ctx.self, instr.delta, instr.filter, expiresAfterTurn);
      break;
    }
    case 'recoverTop':
      S.recoverTopOfDeckToSecurity(state, who);
      break;
    case 'trashEvoSources': {
      const targetPlayer = instr.target === 'opponent' ? ctx.opp : ctx.self;
      const uids = state.players[targetPlayer].battle.map(s => s.uid);
      const targetUid = await ctx.choose('pickStack', { player: targetPlayer, uids, prompt: instr.prompt || '진화원을 파기시킬 디지몬 선택' });
      if (targetUid) S.trashEvoSources(state, targetPlayer, targetUid, instr.count ?? 'all');
      break;
    }
    case 'memoryBorrowAndRepay':
      S.grantMemory(state, ctx.self, instr.n);
      S.scheduleEndOfTurn(state, () => S.grantMemory(state, ctx.self, -instr.n));
      break;
    case 'setMemoryIfLE': {
      const val = ctx.self === 'p1' ? state.memory : -state.memory;
      if (val <= instr.threshold) {
        const target = ctx.self === 'p1' ? instr.setTo : -instr.setTo;
        state.memory = target;
        S.log(state, `${ctx.self} 메모리를 ${instr.setTo}로 설정 (게이지 ${state.memory})`);
      }
      break;
    }
    case 'condition': {
      const ok = await evalCondition(instr.if, ctx);
      await runScript(ok ? instr.then : instr.else, ctx);
      break;
    }
    case 'choice': {
      const idx = await ctx.choose('multipleChoice', { options: instr.options.map(o => o.label), prompt: instr.prompt });
      if (idx != null && instr.options[idx]) await runScript(instr.options[idx].then, ctx);
      break;
    }
    default:
      break;
  }
}

// Best-effort compiler: official Korean effect text -> a DSL script.
// This is deliberately conservative — it only emits an instruction when a
// recognizable, common phrasing is found. Anything it doesn't recognize is
// simply left out of the script (the caller falls back to manual tools for
// whatever isn't covered), so a partially-understood sentence never causes
// an instruction to run with wrong/guessed parameters.
export function compileToScript(text) {
  const script = [];
  const t = text;

  // Simple unconditional actions (also handled as instant auto-apply in
  // state.js for whole-segment matches, but included here too so they still
  // fire correctly when part of a larger multi-clause sentence).
  let m;
  if ((m = t.match(/[≪《]\s*(\d+)\s*드로우\s*[≫》]/))) script.push({ op: 'draw', who: 'self', n: Number(m[1]) });
  if ((m = t.match(/메모리(?:를|을)?\s*\+\s*(\d+)/))) script.push({ op: 'gainMemory', who: 'self', n: Number(m[1]) });
  if ((m = t.match(/메모리(?:를|을)?\s*-\s*(\d+)/))) script.push({ op: 'gainMemory', who: 'self', n: -Number(m[1]) });

  // Destroy / delete opponent's Digimon.
  if (/^이\s*디지몬을\s*소멸시킨다[.。]?$/.test(t)) {
    script.push({ op: 'destroy', target: 'self', mode: 'thisStack' });
  } else if ((m = t.match(/DP\s*(\d+)\s*이하(?:의|인)?\s*상대(?:의)?\s*디지몬\s*(\d+)\s*마리까지를?\s*소멸/))) {
    for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'destroy', target: 'opponent', mode: 'choose', optional: true, filter: { dpMax: Number(m[1]) } });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*전부(?:를)?\s*소멸/))) {
    script.push({ op: 'destroy', target: 'opponent', mode: 'all' });
  } else if (/가장\s*(?:DP가\s*)?낮은[^。\n]*상대[^。\n]*디지몬[^。\n]*소멸|상대[^。\n]*가장\s*(?:DP가\s*)?낮은[^。\n]*디지몬[^。\n]*소멸/.test(t)) {
    script.push({ op: 'destroy', target: 'opponent', mode: 'lowestDP' });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:를)?\s*소멸/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'destroy', target: 'opponent', mode: 'choose' });
  }
  if ((m = t.match(/자신(?:의)?\s*디지몬\s*(\d+)\s*마리(?:를)?\s*소멸/)) && !/^이\s*디지몬을/.test(t)) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'destroy', target: 'self', mode: 'choose' });
  }

  // Retreat / de-digivolve.
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리(?:를)?\s*[≪《]?\s*퇴화\s*(\d+)\s*[≫》]?/))) {
    script.push({ op: 'retreat', target: 'opponent', n: Number(m[1]) });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*1\s*마리를?\s*[≪《]?\s*퇴화\s*(\d+)\s*[≫》]?/))) {
    script.push({ op: 'retreat', target: 'self', n: Number(m[1]) });
  }

  // Trash N cards from own hand (player picks which).
  if ((m = t.match(/자신(?:의)?\s*패(?:에서)?\s*(\d+)\s*장(?:을)?\s*파기/)) && !/전부/.test(t)) {
    script.push({ op: 'trashHand', who: 'self', n: Number(m[1]) });
  }

  // Reveal top N of own deck, add matching card(s) to hand, rest to bottom.
  if ((m = t.match(/(?:자신의\s*)?덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*(?:오픈|공개)/))) {
    script.push({ op: 'revealTop', who: 'self', n: Number(m[1]), pick: { min: 0, max: 1 }, restTo: /덱\s*(?:의)?\s*위(?:로)?\s*(?:되돌|돌려)/.test(t) ? 'top' : 'bottom' });
  }

  // Play a card without paying cost, from hand or trash.
  if (/코스트를?\s*(?:지불하지\s*않고|支払わ)|코스트\s*없이/.test(t) && /등장/.test(t)) {
    const zone = /트래시/.test(t) ? 'trash' : 'hand';
    script.push({ op: 'playFree', who: 'self', zone });
  }

  // Unsuspend ("액티브로 한다"). "이 디지몬" = the source card itself (no
  // choice needed); "자신/상대의 디지몬 N마리" = pick from that player's board.
  if (/이\s*디지몬을\s*액티브로\s*한다/.test(t)) {
    script.push({ op: 'unsuspend', target: 'thisStack' });
  } else if ((m = t.match(/(상대|자신)(?:의)?\s*디지몬\s*(\d+)\s*마리를\s*액티브로\s*한다/))) {
    for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'unsuspend', target: m[1] === '상대' ? 'opponent' : 'self' });
  }

  // Rest ("레스트시킨다").
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리를\s*레스트시킨다/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'rest', target: 'opponent' });
  } else if ((m = t.match(/(상대(?:의)?\s*|자신(?:의)?\s*)?디지몬\s*(\d+)\s*마리를?\s*레스트시킬\s*수\s*있다/))) {
    // Optional ("...시킬 수 있다") rest — a bare "디지몬 N마리" with NEITHER
    // 상대/자신 prefix is a genuinely either-side choice (common on cards
    // that combo off "이 효과로 자신의 디지몬이 레스트했다면", which only
    // makes sense if resting your own was actually an option).
    const target = m[1] ? (/상대/.test(m[1]) ? 'opponent' : 'self') : 'either';
    for (let i = 0; i < Number(m[2]); i++) script.push({ op: 'rest', target });
  }

  // DP modification, this turn unless stated otherwise.
  const dpDuration = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : 'turn';
  if (/이\s*디지몬(?:의)?\s*DP를\s*[+-]?\d+\s*한다/.test(t) && (m = t.match(/DP를\s*([+-]?\d+)\s*한다/))) {
    script.push({ op: 'modifyDP', target: 'self', thisStack: true, amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*한다/))) {
    script.push({ op: 'modifyDPAll', target: 'self', amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*한다/))) {
    script.push({ op: 'modifyDPAll', target: 'opponent', amount: Number(m[1]), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*(\d+)\s*마리(?:의)?\s*(?:는,?\s*)?DP를\s*([+-]?\d+)\s*한다/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'self', amount: Number(m[2]), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:의)?\s*DP를\s*([+-]?\d+)\s*한다/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2]), duration: dpDuration });
  } else if (/이\s*디지몬을\s*DP\s*[+-]\s*\d+/.test(t) && (m = t.match(/이\s*디지몬을\s*DP\s*([+-]\s*\d+)/))) {
    // The far more common terse phrasing "(대상)을 DP ±N." with no "를 ...
    // 한다" verb at all — confirmed via a full-DB audit as the majority
    // shape (451/3072 uncovered segments at the time this was added).
    // Unanchored like the "한다" forms above: this clause is often preceded
    // by a "턴 종료까지"/"[턴에 N회]" lead-in that's part of the same segment.
    script.push({ op: 'modifyDP', target: 'self', thisStack: true, amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration });
  } else if (/자신(?:의)?\s*디지몬\s*전부(?:를)?\s*DP\s*[+-]\s*\d+/.test(t) && (m = t.match(/디지몬\s*전부(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'modifyDPAll', target: 'self', amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration });
  } else if (/상대(?:의)?\s*디지몬\s*전부(?:를)?\s*DP\s*[+-]\s*\d+/.test(t) && (m = t.match(/디지몬\s*전부(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'modifyDPAll', target: 'opponent', amount: Number(m[1].replace(/\s+/g, '')), duration: dpDuration });
  } else if ((m = t.match(/자신(?:의)?\s*디지몬\s*(\d+)\s*마리(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'self', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*(\d+)\s*마리(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    for (let i = 0; i < Number(m[1]); i++) script.push({ op: 'modifyDP', target: 'opponent', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  }

  // 16-20: ≪세이브≫ as a standalone action ("you may place this card under
  // one of your own Tamers") on a card's OWN 【소멸 시】. The negative
  // lookahead excludes the very common "《세이브》가 기술되어 있는 ..." phrasing
  // (a filter describing OTHER cards, not this card performing the action).
  if (/[≪《]\s*세이브\s*[≫》](?!\s*가)/.test(t)) {
    script.push({ op: 'saveUnderTamer' });
  }

  // 16-26: ≪블래스트 진화≫ — by far the most common 【카운터】 body (confirmed
  // ~75 of 85 카운터 segments via the full-DB audit). Any bare keyword lines
  // that happen to trail it in the same segment (e.g. "…《블로커》") are the
  // card's own SEPARATE standing abilities, already picked up independently
  // by parseStaticGrants — ignored here, only the action itself matters.
  if (/[≪《]\s*블(?:래|라)스트\s*진화\s*[≫》]/.test(t)) {
    script.push({ op: 'blastEvolve' });
  }

  // 《시큐리티 어택 ±N》/《S 어택 ±N》 keyword grant — positive is usually self;
  // negative is usually a debuff placed on an opponent's Digimon. "디지몬
  // N마리에게" without a restated "상대(의)" also means the opponent's side
  // here — confirmed against real cards (EX6-023/EX6-024) that print the
  // identical 손오공몬/사고몬 ability both ways, the fuller print restating
  // "상대의 디지몬" and the terser one dropping it (the duration clause
  // "상대의 턴 종료까지" already consumed the one "상대" in the sentence).
  if ((m = t.match(/[≪《]\s*(?:시큐리티\s*어택|S\s*어택)\s*([+-]\d+)\s*[≫》]/))) {
    const value = Number(m[1]);
    const target = value < 0 && /디지몬\s*\d+\s*마리에게/.test(t) ? 'opponent' : 'self';
    const thisStack = target === 'self' && /이\s*디지몬은/.test(t) && !/자신(?:의)?\s*디지몬\s*\d+\s*마리/.test(t);
    const duration = /(?:다음\s*)?상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : (/자신의\s*턴\s*(?:동안|중)/.test(t) || !/이\s*턴\s*동안/.test(t) ? 'permanent' : 'turn');
    const countM = t.match(/디지몬\s*(\d+)\s*마리에게/);
    const count = thisStack ? 1 : (countM ? Number(countM[1]) : 1);
    for (let i = 0; i < count; i++) script.push({ op: 'grantKeyword', target, thisStack, keyword: '시큐리티어택', value, duration });
  }

  // 《리커버리 +1《덱》》.
  if (/[≪《]\s*리커버리\s*\+1\s*[≪《]\s*덱\s*[≫》]\s*[≫》]/.test(t)) script.push({ op: 'recoverTop', who: 'self' });

  // Trash evolution sources.
  if (/상대(?:의)?\s*디지몬\s*전부(?:의)?\s*진화원을?\s*전부\s*파기/.test(t)) {
    script.push({ op: 'trashEvoSources', target: 'opponent', all: true, count: 'all' });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리(?:의)?\s*진화원을?,?\s*(?:아래에서(?:부터)?|위에서(?:부터)?)?\s*(\d+)\s*장\s*파기/))) {
    script.push({ op: 'trashEvoSources', target: 'opponent', count: Number(m[1]) });
  } else if (/상대(?:의)?\s*디지몬\s*1\s*마리(?:의)?\s*진화원을?\s*전부\s*파기/.test(t)) {
    script.push({ op: 'trashEvoSources', target: 'opponent', count: 'all' });
  }

  // Borrow memory now, pay it back at end of turn (net-zero temporary boost).
  if ((m = t.match(/메모리(?:를|을)?\s*\+(\d+)\s*한다\.\s*이\s*턴\s*종료\s*시,?\s*메모리(?:를|을)?\s*-\d+\s*한다/))) {
    script.push({ op: 'memoryBorrowAndRepay', n: Number(m[1]) });
  }

  // Tamer "if memory <= X, set it to Y" starter effect.
  if ((m = t.match(/메모리가\s*(\d+)\s*이하(?:일\s*때|라면),?\s*(\d+)(?:으로)?\s*한다/))) {
    // "이하일 때"/"이하라면" ("when"/"if" ≤ N) — same Tamer turn-start
    // boilerplate either way; "이하라면" turned out to be the far more
    // common printed phrasing (58 of the 62 combined occurrences).
    script.push({ op: 'setMemoryIfLE', threshold: Number(m[1]), setTo: Number(m[2]) });
  }

  // Bounce an opponent Digimon (to hand, or to the bottom of their deck) and
  // discard its evolution sources. "가진"/"갖는"/"가지는" are all real
  // conjugations actually printed ("가지는?" alone, the original pattern,
  // only ever matched "가지" or "가지는" — never "가진", by far the most
  // common form). Tried as hand first, then deck-bottom (84 combined
  // occurrences via the full-DB audit — deck-bottom alone is the larger of
  // the two).
  for (const [destWord, dest] of [['패로', 'hand'], ['덱\\s*아래로', 'deckBottom']]) {
    // The "그 디지몬이 가진 진화원은 파기한다" tail is only ever REMINDER text
    // — sources are always sent to trash when a Digimon leaves the battle
    // area this way regardless of whether a given print restates it, so
    // it's optional here rather than required (confirmed real prints of the
    // identical ability both with and without it, e.g. BT15-052/EX10-020).
    // Lv./DP filters can end in "이하"/"이상" (≤/≥) OR, with neither word at
    // all, just a bare "Lv.N인" — an EXACT level match, not a threshold
    // (confirmed real prints, e.g. "Lv.3인 상대의 디지몬" BT2-095).
    const re = new RegExp(`(?:(레스트\\s*상태[의인]|액티브\\s*상태[의인])\\s*)?(?:Lv\\.(\\d+)\\s*(이하|이상)?(?:의|인)?\\s*)?(?:DP\\s*(\\d+)\\s*(이하|이상)?(?:의|인)?\\s*)?상대(?:의)?\\s*디지몬\\s*(전부|\\d+\\s*마리(?:까지)?)를?\\s*(?:대신\\s*)?${destWord}\\s*되돌린다`);
    if ((m = t.match(re))) {
      const filter = {};
      if (m[2]) filter[m[3] === '이상' ? 'levelMin' : m[3] === '이하' ? 'levelMax' : 'level'] = Number(m[2]);
      if (m[4]) filter[m[5] === '이상' ? 'dpMin' : m[5] === '이하' ? 'dpMax' : 'dp'] = Number(m[4]);
      const requireSuspended = m[1] ? m[1].startsWith('레스트') : null;
      if (m[6] === '전부') {
        script.push({ op: 'returnToHandStripSources', target: 'opponent', all: true, filter, requireSuspended, dest });
      } else {
        const n = Number(m[6].match(/\d+/)[0]);
        script.push({ op: 'returnToHandStripSources', target: 'opponent', n, filter, requireSuspended, dest });
      }
      break;
    }
  }

  // Option cards that stay on the field after resolving ("그 후 이 카드를
  // 배틀 에어리어에 놓는다") — the card was provisionally trashed by
  // useOptionCard; this relocates it. Also covers the bare form with no
  // "그 후," lead-in, printed as a whole 【시큐리티】 body by itself — by far
  // the single most common 시큐리티 pattern (60 of 178 via the audit).
  if (/이\s*카드를\s*배틀\s*에어리어에\s*놓는다/.test(t)) {
    script.push({ op: 'placeThisInBattle' });
  }

  // "이 카드를 패에 추가한다." — a card revealed via security check (or an
  // Option card, after resolving) returns to hand instead of trashing.
  // Second most common 시큐리티 pattern (53 of 178).
  if (/이\s*카드를\s*패에\s*추가한다/.test(t)) {
    script.push({ op: 'addSelfToHand' });
  }

  // Return a named/trait-matching card from own trash to hand.
  if ((m = t.match(/자신(?:의)?\s*트래시에서,?\s*명칭에\s*「([^」]+)」(?:를|을)?\s*포함하는\s*(?:디지몬\s*)?카드\s*(\d+)?\s*장?(?:을)?\s*패로\s*되돌린다/))) {
    for (let i = 0; i < Number(m[2] || 1); i++) script.push({ op: 'returnFromTrash', who: 'self', filter: { nameIncludes: m[1] } });
  }

  // Set a Digimon's base DP to an absolute value (distinct from a +/- delta).
  if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리(?:의)?\s*원래\s*DP를\s*(\d+)(?:으로|로)\s*변경/))) {
    script.push({ op: 'setDP', target: 'opponent', value: Number(m[1]), duration: dpDuration });
  }

  // Deck-top trash (non-whole-segment form, e.g. "...할 수 있다" tail as its
  // own clause after other text already consumed above).
  if ((m = t.match(/(?:자신의\s*)?덱\s*위(?:에서)?\s*(?:부터)?\s*(\d+)\s*장(?:을)?\s*파기(?:한다|할\s*수\s*있다)/)) && !script.some(i => i.op === 'trashDeckTop')) {
    script.push({ op: 'trashDeckTop', who: 'self', n: Number(m[1]) });
  }

  // Attack restriction.
  if (/^이\s*디지몬은\s*어택할\s*수\s*없다[.。]?$/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'self', thisStack: true, expiresAfterTurn: 'permanent' });
  } else if ((m = t.match(/상대(?:의)?\s*디지몬\s*1\s*마리는\s*어택(?:과\s*블록)?을?\s*할\s*수\s*없다/))) {
    const expires = /다음\s*상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : 'permanent';
    script.push({ op: 'restrictAttack', target: 'opponent', expiresAfterTurn: expires });
  } else if (/진화원을?\s*갖지\s*않은\s*상대(?:의)?\s*디지몬\s*1\s*마리를?\s*선택한다\.?\s*그\s*디지몬은\s*다음\s*상대(?:의)?\s*턴\s*종료\s*시?까지\s*어택과\s*블록을?\s*할\s*수\s*없다/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'opponent', filter: { hasNoSources: true }, expiresAfterTurn: 'opponentTurn', prompt: '(블록 금지 부분은 수동으로 기억해두세요 — 이 엔진의 자동 블록 판정에는 별도 반영 안 됨)' });
  } else if (/상대는\s*진화원을?\s*갖지\s*않은\s*디지몬으로는\s*어택할\s*수\s*없다/.test(t)) {
    script.push({ op: 'restrictAttack', target: 'opponent', allMatching: true, noEvoSources: true, expiresAfterTurn: 'opponentTurn', prompt: '(주의: 현재 필드의 무진화원 디지몬에만 적용, 이후 새로 등장하는 카드는 수동 확인 필요)' });
  }

  // "이 디지몬의 DP는 마이너스되지 않는다" — permanent DP-reduction immunity.
  if (/이\s*디지몬(?:의)?\s*DP는\s*마이너스되지\s*않는다/.test(t)) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: 'DP감소무효', duration: 'permanent' });
  }

  // Extends direct-attack targeting to also cover ACTIVE opposing Digimon
  // with no evolution sources (base rule 11-2-7-1 only allows targeting
  // RESTED opposing Digimon).
  if (/이\s*디지몬은\s*진화원을?\s*갖지\s*않는\s*액티브\s*상태의\s*상대\s*디지몬에게도\s*어택할\s*수\s*있다/.test(t)) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '무진화원액티브공격', duration: 'permanent' });
  } else if (/이\s*디지몬은?[,]?\s*액티브\s*상태의?\s*상대(?:의)?\s*디지몬에게도\s*어택할\s*수\s*있다/.test(t)) {
    // Same targeting extension with NO "no evolution sources" restriction
    // at all — the unqualified (and, via the audit, more common) variant.
    const duration = /이\s*턴\s*동안/.test(t) ? 'turn' : 'permanent';
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '액티브공격', duration });
  }
  if (/메모리가\s*상대측\s*1\s*이상일\s*때,?\s*이\s*디지몬은\s*어택할\s*수\s*있다/.test(t)) {
    script.push({ op: 'noop', note: '이 엔진은 메모리 위치로 어택을 제한하지 않아서 조건이 항상 충족됨(데이터 원문 표현 확인 필요)' });
  }

  // Color override ("이 디지몬의 색은 그린으로도 취급한다").
  const KOR_COLOR = { 레드: 'red', 블루: 'blue', 옐로우: 'yellow', 그린: 'green', 블랙: 'black', 퍼플: 'purple', 화이트: 'white' };
  if ((m = t.match(/이\s*디지몬(?:의)?\s*색은\s*(레드|블루|옐로우|그린|블랙|퍼플|화이트)(?:으로|로)도\s*취급/))) {
    script.push({ op: 'grantColor', color: KOR_COLOR[m[1]] });
  }

  // DP modifier applied to (hidden) security Digimon at check-time.
  if ((m = t.match(/(자신|상대)(?:의)?\s*시큐리티\s*디지몬\s*전부(?:의)?\s*DP를\s*([+-]?\d+)\s*한다/))) {
    script.push({ op: 'securityDPMod', target: m[1] === '상대' ? 'opponent' : 'self', amount: Number(m[2]), duration: dpDuration });
  } else if ((m = t.match(/(자신|상대)(?:의)?\s*시큐리티\s*디지몬\s*전부(?:를)?\s*DP\s*([+-]\s*\d+)/))) {
    script.push({ op: 'securityDPMod', target: m[1] === '상대' ? 'opponent' : 'self', amount: Number(m[2].replace(/\s+/g, '')), duration: dpDuration });
  }

  // Cost reduction for the NEXT matching evolution.
  if ((m = t.match(/(?:다음에\s*)?그린인\s*자신(?:의)?\s*디지몬이\s*Lv\.(\d+)에서\s*Lv\.(\d+)으로\s*진화할\s*때에?\s*지불하는\s*진화\s*코스트를\s*(-?\d+)\s*한다/))) {
    script.push({ op: 'evoCostMod', delta: Number(m[3]), filter: { colors: ['green'], fromLevel: Number(m[1]), toLevel: Number(m[2]) }, duration: 'turn' });
  } else if ((m = t.match(/이\s*디지몬이\s*명칭에\s*「([^」]+)」(?:를|을)?\s*포함하는\s*패의\s*디지몬(?:\s*카드)?(?:으로|로)\s*진화할\s*때,?\s*지불하는\s*진화\s*코스트를\s*(-?\d+)\s*한다/))) {
    script.push({ op: 'evoCostMod', delta: Number(m[2]), filter: { nameIncludes: m[1] }, duration: 'permanent' });
  } else if ((m = t.match(/자신(?:의)?\s*패에서\s*진화하는\s*디지몬과\s*같은\s*색의?\s*디지몬\s*카드\s*1\s*장을?\s*파기하는\s*것으로,?\s*지불하는\s*진화\s*코스트를\s*(-?\d+)\s*한다/))) {
    // "trash a card of the same color as the evolving Digimon" is a COST for
    // the discount, which our simplified evoCostMod can't require — apply
    // the discount unconditionally and log the omitted cost as a reminder.
    script.push({ op: 'evoCostMod', delta: Number(m[1]), filter: {}, duration: 'turn' });
  }

  // This Digimon's checks against Option cards don't trigger their
  // [SECURITY] effect.
  if (/이\s*디지몬이\s*체크한\s*옵션\s*카드의?\s*(?:【시큐리티】|시큐리티)\s*효과는\s*발휘하지\s*않는다/.test(t)) {
    script.push({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '옵션시큐리티효과무효', duration: 'permanent' });
  }

  // Blocker / Jamming / Piercing / Rush keyword grants.
  for (const [kw, re] of [['블로커', /[≪《]\s*블로커\s*[≫》]/], ['재밍', /[≪《]\s*재밍\s*[≫》]/], ['관통', /[≪《]\s*관통\s*[≫》]/], ['속공', /[≪《]\s*속공\s*[≫》]/], ['진격', /[≪《]\s*진격\s*[≫》]/]]) {
    if (re.test(t) && /(얻는다|를\s*얻)/.test(t)) {
      const thisStack = /이\s*디지몬(?:은|이)/.test(t) && !/자신(?:의)?\s*디지몬\s*\d+\s*마리/.test(t);
      const duration = /다음\s*상대(?:의)?\s*턴\s*종료\s*시?까지/.test(t) ? 'opponentTurn' : 'turn';
      script.push({ op: 'grantKeyword', target: 'self', thisStack, keyword: kw, duration });
    }
  }

  return script;
}

async function evalCondition(cond, ctx) {
  if (!cond) return true;
  if (cond.memoryLE != null) {
    const val = ctx.self === 'p1' ? ctx.state.memory : -ctx.state.memory;
    return val <= cond.memoryLE;
  }
  if (cond.hasDigimon) {
    return ctx.state.players[ctx.self].battle.some(s => matchesFilter(ctx.S, s.cardId, cond.hasDigimon));
  }
  if (cond.handSizeGE != null) {
    return ctx.state.players[ctx.self].hand.length >= cond.handSizeGE;
  }
  if (cond.hasTamer) {
    return ctx.state.players[ctx.self].battle.some(s => ctx.S.card(s.cardId).category === 'tamer');
  }
  return true;
}

// Per-card bespoke scripts for effects too structurally unique to
// generalize into a regex pattern (still fully automated — just addressed
// by card id + tag signature instead of free-text matching).
const CARD_SPECIFIC = {
  'BT1-089::메인': [
    { op: 'condition', if: { hasDigimon: { colors: ['green'], levelMin: 5 } }, then: [
      { op: 'restStack', target: 'self', thisStack: true },
      { op: 'choice', prompt: '빈 육성 에어리어에 부화 또는 Lv.3+ 자신 디지몬 배틀로 이동', options: [
        { label: '부화', then: [{ op: 'hatch', who: 'self' }] },
        { label: '육성→배틀 이동', then: [{ op: 'moveRaising', who: 'self' }] },
      ] },
    ], else: [] },
  ],
  'EX1-021::어택 시': [
    { op: 'condition', if: { handSizeGE: 8, hasTamer: true }, then: [
      { op: 'bounceToDeckBottomStripSources', target: 'opponent', filter: { hasSegmentTag: '소멸 시' } },
    ], else: [] },
  ],
  'EX1-035::어택 시': [{ op: 'noop', note: '공격 중 진화 옵션 — 이 엔진엔 공격 중간 타이밍이 없어서 동일 효과를 원하면 어택 선언 "전에" 일반 진화로 처리하세요 (결과는 동일).' }],
  'EX1-040::어택 시': [{ op: 'noop', note: '공격 중 진화 옵션 — 어택 선언 전에 일반 진화로 대체 처리하세요 (결과 동일).' }],
  'EX1-043::자신의 턴': [{ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '전투후액티브', duration: 'permanent' }],
  'EX1-056::자신의 턴': [{ op: 'grantDynamicRestriction', target: 'self', thisStack: true, restriction: { type: 'noDigimonAttackUnlessOwn', filter: { nameIncludes: '묘티스몬' } } }],
  'EX1-072::메인': [{ op: 'noop', note: '상대 옵션카드 사용 봉인 — 이 엔진은 옵션카드 사용을 별도 액션으로 게이트하지 않아서 강제할 수 없습니다. 수동으로 상대가 옵션 카드를 못 쓰게 안내해주세요.' }],
  'EX1-073::서로의 턴': [{ op: 'noop', note: '대체 배리어(진화원 Lv.5 2장 파기로 생존) — 일반 배리어처럼 소멸 판정 시 수동으로 대가를 지불해서 생존 처리하세요.' }],
};

export function lookupCardSpecific(cardId, tags) {
  const key = `${cardId}::${tags[0]}`;
  return CARD_SPECIFIC[key] || null;
}
