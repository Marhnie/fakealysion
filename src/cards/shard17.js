export const SCRIPTS = {}; export const OPS = {}; export const HOOKS = {};
// Shard 17 (verify-reveal-3) — "덱 위 N장 오픈 → 조건에 맞는 카드를 골라 (패 / 진화원 아래 / 테이머 아래 / 코스트 없이 등장 …) 나머지는 되돌린다/파기" cards
// whose printed text does not fit the generic revealTop op (several destinations, alternatives "A하거나 B", face-down placement, cost -N play, …).
// One op r17_reveal drives all of them; state.js is only used inside functions (it imports cards/index.js).
import * as S from '../state.js';

const C = (id) => S.card(id);
const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const hasT = (id, ...ts) => (C(id).types || []).some((t) => ts.includes(t));
const nameIs = (id, ...ns) => S.cardNames(id).some((x) => ns.includes(x));
const nameHas = (id, ...ns) => ns.some((n) => S.cardNames(id).some((x) => x.includes(n)) || S.cardNameInfo(id).incl.some((x) => x.includes(n)));
const ment = (id, ...ns) => ns.some((n) => S.cardMentions(id, n));
const cat = (id) => C(id).category;
const D = (desc) => { let p; return (id) => { p ??= S.cardDescPredicate(desc); if (!p) throw new Error('desc predicate unavailable: ' + desc); return !!p(C(id)); }; };
const and = (...fs) => (id) => fs.every((f) => f(id));
const or = (...fs) => (id) => fs.some((f) => f(id));
const any = () => true;
const stacksOf = (state, p) => [state.players[p].raising, ...state.players[p].battle].filter(Boolean);
const findStack = (state, p, uid) => stacksOf(state, p).find((s) => s.uid === uid) || null;
const stkTraitPred = (...ts) => (st) => S.card(st.cardId) && (C(st.cardId).types || []).some((t) => ts.includes(t));

function putUnder(state, p, st, id, faceDown) {
  const fd = S.fdCount(st);
  if (faceDown) { st.sources.unshift(id); st.s5fd = (st.s5fd || 0) + 1; } // face-down cards form the bottom block of sources (shard5 model)
  else st.sources.splice(Math.min(fd, st.sources.length), 0, id);
  S.recomputeStackGrants(st);
  S.log(state, `${p} ${C(id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 ${faceDown ? '뒷면으로 ' : ''}놓음`);
  if (faceDown) S.emitGameEvent(state, 'faceDownSource', { owner: p, stack: st, cause: 'effect' });
}

// which own stacks a step's destination can use
function destStacks(ctx, step) {
  const { state, self } = ctx;
  if (step.dest === 'evoThis') { const st = findStack(state, self, ctx.sourceStackUid); return st ? [st] : []; }
  if (step.dest === 'tamer') return state.players[self].battle.filter((s) => C(s.cardId).category === 'tamer' && (!step.tp || step.tp(s)));
  if (step.dest === 'digimonSrc') return stacksOf(state, self).filter((s) => C(s.cardId).category === 'digimon' && (!step.tp || step.tp(s)));
  return null;
}
const stepUsable = (ctx, step, id) => {
  if (step.dest === 'play') {
    const c = C(id);
    if (c.category === 'option') return !!step.allowOption && S.optionColorOk(ctx.state, ctx.self, id) && S.canPayCost(ctx.state, Math.max(0, (c.cost || 0) + (step.delta || 0)));
    if (step.delta) return S.canPayCost(ctx.state, Math.max(0, (c.cost || 0) + step.delta));
    return true;
  }
  const ds = destStacks(ctx, step);
  return ds === null ? true : ds.length > 0;
};
const maxMatch = (ids, avail, preds) => { // max #slots fillable by distinct cards
  const owner = new Map();
  const tryK = (k, seen) => { for (const ci of avail) { if (seen.has(ci) || !preds[k](ids[ci])) continue; seen.add(ci); if (!owner.has(ci) || tryK(owner.get(ci), seen)) { owner.set(ci, k); return true; } } return false; };
  let n = 0; for (let k = 0; k < preds.length; k++) if (tryK(k, new Set())) n++;
  return n;
};

// instr: { who?, whoChoice?, n, optionalReveal?, steps:[{ pred, dest:'hand'|'trash'|'evoThis'|'tamer'|'digimonSrc'|'play', label, optional?, fd?, tp?, delta?, rested?, allowOption?, extraMax? }],
//          exclusive?: one card total, its destination chosen among the steps it satisfies, restTo:'bottom'|'top'|'either'|'trash', costBonus?(ctx) }
OPS.r17_reveal = async (instr, ctx) => {
  const { state, self } = ctx;
  let who = self;
  if (instr.optionalReveal && !(await ctx.choose('confirmEffect', { player: self, prompt: `덱 위 ${instr.n}장을 오픈할까요?` }))) return;
  if (instr.whoChoice) { const wi = await ctx.choose('multipleChoice', { player: self, prompt: '어느 쪽 덱을 오픈할까요?', options: ['자신의 덱', '상대의 덱'] }); if (wi === 1) who = opp(self); }
  const pl = state.players[who];
  const rev = pl.deck.splice(0, instr.n);
  if (!rev.length) return;
  S.log(state, `${who} 덱 위 ${rev.length}장 오픈: ${rev.map((id) => C(id).nameKo).join(', ')}`);
  const steps = instr.steps || [];
  const taken = []; // { i, step }
  const takenIdx = () => taken.map((t) => t.i);
  const promptFor = (st) => `공개된 카드 중 ${st.label || '가져갈 카드'} 선택`;
  const pick = async (elig, max, required, prompt, dest) => {
    const r = await ctx.choose('pickFromRevealed', { player: self, revealed: rev, eligible: elig.map((i) => ({ id: rev[i], i })), min: 0, max, required: required && elig.length > 0, prompt, dest });
    return [...new Set(r || [])].filter((i) => elig.includes(i)).slice(0, max);
  };
  if (instr.exclusive) {
    const ok = (i, st) => st.pred(rev[i]) && stepUsable(ctx, st, rev[i]);
    const elig = rev.map((_, i) => i).filter((i) => steps.some((st) => ok(i, st)));
    const [i] = await pick(elig, 1, !instr.optional, instr.prompt || '공개된 카드 중 1장 선택', 'hand');
    if (i != null) {
      const ms = steps.filter((st) => ok(i, st));
      let st = ms[0];
      if (ms.length > 1) { const k = await ctx.choose('multipleChoice', { player: self, prompt: `${C(rev[i]).nameKo}: 어떻게 처리할까요?`, options: ms.map((x) => x.label) }); st = ms[Number.isInteger(k) && k >= 0 && k < ms.length ? k : 0]; }
      taken.push({ i, step: st });
    }
  } else {
    const slots = []; for (const st of steps) for (let k = 0; k < (st.count || 1); k++) slots.push(st);
    for (let si = 0; si < slots.length; si++) {
      const st = slots[si];
      const avail = rev.map((_, i) => i).filter((i) => !takenIdx().includes(i));
      const cand = avail.filter((i) => st.pred(rev[i]) && stepUsable(ctx, st, rev[i]));
      if (!cand.length) continue;
      const restP = slots.slice(si + 1).map((x) => x.pred);
      const best = maxMatch(rev, avail, slots.slice(si).map((x) => x.pred));
      const el = cand.filter((i) => 1 + maxMatch(rev, avail.filter((x) => x !== i), restP) >= best);
      const [i] = await pick(el, 1, !st.optional, promptFor(st), st.dest);
      if (i != null) taken.push({ i, step: st });
    }
  }
  ctx._revealAdded = taken.filter((t) => t.step.dest === 'hand').length;
  ctx._revealTaken = taken.length;
  // ---- place the picked cards
  const back = [];
  const rest = rev.filter((_, i) => !takenIdx().includes(i));
  for (const { i, step } of taken) {
    const id = rev[i];
    if (step.dest === 'hand') { pl.hand.push(id); S.log(state, `${who} ${C(id).nameKo}을(를) 패에 추가`); }
    else if (step.dest === 'trash') { pl.trash.push(id); S.log(state, `${who} ${C(id).nameKo}을(를) 파기`); }
    else if (step.dest === 'play') {
      const c = C(id);
      const cost = Math.max(0, (c.cost || 0) + (step.delta || 0));
      if (c.category === 'option') { pl.hand.push(id); const ix = pl.hand.length - 1; if (!S.useOptionCard(state, who, ix, { costDelta: step.delta || 0 })) { pl.hand.pop(); back.push(id); } }
      else { pl.hand.push(id); const ix = pl.hand.length - 1; if (step.delta && cost > 0) S.spendMemory(state, cost); const st = step.delta ? S.playDigimonFresh(state, who, ix) : S.playFreeFromZone(state, who, 'hand', ix, { rested: !!step.rested, noTriggers: !!step.noTriggers }); if (!st) { const k = pl.hand.lastIndexOf(id); if (k >= 0 && pl.hand.length - 1 === k) pl.hand.pop(); back.push(id); } else if (step.delta) st.playedByEffect = true; }
    } else { // under a stack
      const ds = destStacks(ctx, step) || [];
      let target = ds[0];
      if (ds.length > 1) { const uid = await ctx.choose('pickStack', { player: self, uids: ds.map((s) => s.uid), prompt: step.stackPrompt || `${C(id).nameKo}을(를) 놓을 대상 선택` }); target = ds.find((s) => s.uid === uid) || ds[0]; }
      if (target) putUnder(state, who, target, id, !!step.fd); else back.push(id);
    }
  }
  const back2 = [...rest, ...back];
  // ---- the rest
  let where = instr.restTo || 'bottom';
  if (where === 'trash') { pl.trash.push(...back2); if (back2.length) S.log(state, `${who} 나머지 ${back2.length}장 파기`); return; }
  if (!back2.length) return;
  if (where === 'either') { const w = await ctx.choose('multipleChoice', { player: self, prompt: `공개한 나머지 ${back2.length}장을 덱 위/아래 어느 쪽으로 되돌릴까요?`, options: ['덱 위로', '덱 아래로'] }); where = w === 0 ? 'top' : 'bottom'; }
  const ord = await S.orderPlacement(ctx.choose, self, back2, `덱 ${where === 'bottom' ? '아래' : '위'}로 되돌릴 카드 ${back2.length}장의 순서를 정하세요 (위쪽부터)`);
  if (where === 'top') pl.deck.unshift(...ord); else pl.deck.push(...ord);
  S.log(state, `${who} 나머지 ${ord.length}장을 덱 ${where === 'top' ? '위' : '아래'}로 되돌림`);
};

const R = (o) => ({ op: 'r17_reveal', n: 3, restTo: 'bottom', ...o });
const H = (id, tags, script) => { for (const t of tags) SCRIPTS[`${id}::${t}`] = script; };

// ---- BT18-061 【등장 시】 3장: 테이머 카드 또는 블랙인 Lv.4 이하 카드 1장 → 이 디지몬의 진화원 아래에 놓을 수 있다. 나머지 덱 위 또는 아래
H('BT18-061', ['등장 시'], [R({ restTo: 'either', steps: [{ pred: (id) => cat(id) === 'tamer' || ((C(id).colors || []).includes('black') && C(id).level != null && C(id).level <= 4), dest: 'evoThis', optional: true, label: '진화원 아래에 놓을 카드(테이머 카드 / 블랙 Lv.4 이하)' }] })]);
// ---- BT19-055 【소멸 시】: 「나이트몬」 기술 / 「트와일라잇」 카드 1장 → 패, 1장 → 자신의 테이머 아래
{ const p = or((id) => ment(id, '나이트몬'), (id) => hasT(id, '트와일라잇'));
  H('BT19-055', ['소멸 시'], [R({ steps: [{ pred: p, dest: 'hand', label: '패에 추가할 카드' }, { pred: p, dest: 'tamer', label: '테이머 아래에 놓을 카드', stackPrompt: '카드를 놓을 자신의 테이머 선택' }] })]); }
// ---- P-167 【자신의 메인 페이즈 개시 시】【진화 시】: 자신의 디지몬의 진화원에서 광물형/광석형 1장 파기 → 3장: 광물형/광석형 1장을 패 or 이 디지몬 진화원 아래. 나머지 위/아래
{ const p = (id) => hasT(id, '광물형', '광석형');
  const s = [{ op: 'r17_p167' }];
  OPS.r17_p167 = async (instr, ctx) => {
    const { state, self } = ctx;
    const cands = []; for (const st of stacksOf(state, self)) st.sources.forEach((id, k) => { if (p(id)) cands.push({ st, k, id }); });
    if (!cands.length) { S.log(state, `${self} 진화원에 광물형/광석형 카드가 없어 효과를 처리하지 않음`); return; }
    const ids = cands.map((c) => c.id);
    const r = await ctx.choose('pickFromRevealed', { player: self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 1, max: 1, required: true, prompt: '비용: 자신의 디지몬의 진화원에서 파기할 「광물형」/「광석형」 카드 선택', dest: '파기' });
    const c = cands[(r && r[0]) ?? 0] || cands[0];
    if (!c) return;
    const fdBefore = S.fdCount(c.st);
    c.st.sources.splice(c.k, 1); if (c.k < fdBefore) c.st.s5fd = Math.max(0, (c.st.s5fd || 0) - 1);
    S.recomputeStackGrants(c.st);
    state.players[self].trash.push(c.id);
    S.log(state, `${self} ${C(c.st.cardId).nameKo}의 진화원에서 ${C(c.id).nameKo} 파기 (비용)`);
    await OPS.r17_reveal(R({ restTo: 'either', exclusive: true, steps: [{ pred: p, dest: 'hand', label: '패에 추가' }, { pred: p, dest: 'evoThis', label: '이 디지몬의 진화원 아래에 놓기' }] }), ctx);
  };
  H('P-167', ['자신의 메인 페이즈 개시 시', '진화 시'], s); }
// ---- BT21-058: 3장 「벰몬」 기술 1장 → 패, 나머지 파기. 그 후 트래시의 「벰몬」 2장까지 → 자신의 디지몬 1마리의 진화원 아래
H('BT21-058', ['등장 시', '진화 시'], [R({ restTo: 'trash', steps: [{ pred: (id) => ment(id, '벰몬'), dest: 'hand', label: '패에 추가할 「벰몬」이 기술된 카드' }] }), { op: 'r17_vemUnder' }]);
OPS.r17_vemUnder = async (instr, ctx) => {
  const { state, self } = ctx; const pl = state.players[self];
  const digs = stacksOf(state, self).filter((s) => C(s.cardId).category === 'digimon');
  if (!digs.length) return;
  const moved = [];
  for (let n = 0; n < 2; n++) {
    const idxs = pl.trash.map((id, i) => i).filter((i) => nameIs(pl.trash[i], '벰몬'));
    if (!idxs.length) break;
    const ids = idxs.map((i) => pl.trash[i]);
    const r = await ctx.choose('pickFromRevealed', { player: self, revealed: ids, eligible: ids.map((id, i) => ({ id, i })), min: 0, max: 1, prompt: `트래시의 「벰몬」을 진화원 아래에 놓을까요? (${n + 1}/2, 안 놓으려면 확인)`, dest: '진화원 아래' });
    if (!r || !r.length) break;
    moved.push(pl.trash.splice(idxs[r[0]], 1)[0]);
  }
  if (!moved.length) return;
  let target = digs[0];
  if (digs.length > 1) { const uid = await ctx.choose('pickStack', { player: self, uids: digs.map((s) => s.uid), prompt: '「벰몬」을 진화원 아래에 놓을 디지몬 선택' }); target = digs.find((s) => s.uid === uid) || digs[0]; }
  for (const id of moved) putUnder(state, self, target, id, false);
};
// ---- BT21-087: 3장 「벰몬」 1장 → 코스트 없이 등장 / 「벰몬」 기술 1장 → 패. 나머지 파기
H('BT21-087', ['등장 시'], [R({ restTo: 'trash', exclusive: true, steps: [{ pred: (id) => nameIs(id, '벰몬') && cat(id) !== 'option', dest: 'play', label: '「벰몬」을 코스트 없이 등장' }, { pred: (id) => ment(id, '벰몬'), dest: 'hand', label: '「벰몬」이 기술된 카드를 패에 추가' }] })]);
// ---- EX9-007/014/023/035/058: 「DM」 카드 1장 → 패, 「Ver.N」 카드 1장 → 「DM」 자신의 디지몬의 진화원 아래에 뒷면으로. 나머지 덱 아래
for (const [id, v] of [['EX9-007', 'Ver.1'], ['EX9-014', 'Ver.2'], ['EX9-023', 'Ver.3'], ['EX9-035', 'Ver.4'], ['EX9-058', 'Ver.5']]) {
  H(id, ['등장 시'], [R({ steps: [{ pred: (c) => hasT(c, 'DM'), dest: 'hand', label: '패에 추가할 「DM」 카드' }, { pred: (c) => hasT(c, v), dest: 'digimonSrc', tp: stkTraitPred('DM'), fd: true, label: `「${v}」 카드(뒷면으로 「DM」 디지몬의 진화원 아래)`, stackPrompt: '카드를 놓을 「DM」 디지몬 선택' }] })]);
}
// ---- EX9-053: 「DM」 등장 코스트 4 이하(+이 디지몬의 뒷면 진화원 1장마다 +1) 카드 1장을 코스트 없이 등장시킬 수 있다. 나머지 덱 아래
H('EX9-053', ['등장 시', '진화 시'], [{ op: 'r17_ex9053' }]);
OPS.r17_ex9053 = async (instr, ctx) => {
  const st = findStack(ctx.state, ctx.self, ctx.sourceStackUid);
  const lim = 4 + (st ? S.fdCount(st) : 0);
  await OPS.r17_reveal(R({ steps: [{ pred: (id) => hasT(id, 'DM') && cat(id) !== 'option' && (C(id).cost || 0) <= lim, dest: 'play', optional: true, label: `코스트 ${lim} 이하의 「DM」 카드(코스트 없이 등장)` }] }), ctx);
};
// ---- BT24-058: 「머신형」/「사이보그형」/「TS」 디지몬/테이머 카드 1장 → 패 or 그 특징의 자신의 디지몬의 진화원 아래. 나머지 덱 위 또는 아래
{ const tr = (id) => hasT(id, '머신형', '사이보그형', 'TS');
  H('BT24-058', ['등장 시', '진화 시'], [R({ restTo: 'either', exclusive: true, steps: [{ pred: (id) => tr(id) && ['digimon', 'tamer'].includes(cat(id)), dest: 'hand', label: '패에 추가' }, { pred: (id) => tr(id) && ['digimon', 'tamer'].includes(cat(id)), dest: 'digimonSrc', tp: stkTraitPred('머신형', '사이보그형', 'TS'), label: '「머신형」/「사이보그형」/「TS」 디지몬의 진화원 아래에 놓기', stackPrompt: '카드를 놓을 디지몬 선택' }] })]); }
// ---- BT24-066: (특징 소악마형/마룡형/사룡형/암흑기사형 퍼플 카드 or 퍼플 테이머) 1장 → 패, 1장 → 파기. 나머지 덱 아래. 그 후 패 1장 파기
{ const p = or(and((id) => hasT(id, '소악마형', '마룡형', '사룡형', '암흑기사형'), (id) => (C(id).colors || []).includes('purple')), and((id) => cat(id) === 'tamer', (id) => (C(id).colors || []).includes('purple')));
  H('BT24-066', ['등장 시'], [R({ steps: [{ pred: p, dest: 'hand', label: '패에 추가할 카드' }, { pred: p, dest: 'trash', label: '파기할 카드' }] }), { op: 'trashHand', who: 'self', n: 1 }]); }
// ---- BT25-074: 【턴 1회】 3장 등장 코스트 12 이하의 「D-브리가드」/「엑셀」 디지몬 카드 1장을 등장 코스트 -5로 등장시킬 수 있다. 나머지 파기
H('BT25-074', ['진화 시'], [R({ restTo: 'trash', steps: [{ pred: (id) => cat(id) === 'digimon' && hasT(id, 'D-브리가드', '엑셀') && (C(id).cost || 0) <= 12, dest: 'play', delta: -5, optional: true, label: '등장 코스트 -5로 등장시킬 카드' }] })]);
// ---- BT25-078: 「3총사」 기술 1장 → 패 / 특징 「3총사」 1장 → 이 디지몬의 진화원 아래 (할 수 있다). 나머지 덱 아래
H('BT25-078', ['이동 시'], [R({ exclusive: true, optional: true, steps: [{ pred: (id) => ment(id, '3총사'), dest: 'hand', label: '패에 추가(「3총사」가 기술된 카드)' }, { pred: (id) => hasT(id, '3총사'), dest: 'evoThis', label: '이 디지몬의 진화원 아래에 놓기(특징 「3총사」)' }] })]);
// ---- ST23-06 / ST24-04: 특징 1장 → 패, 카드 1장 → 그 특징의 자신의 테이머 1명 아래에 뒷면으로. 나머지 덱 아래
H('ST23-06', ['이동 시'], [R({ steps: [{ pred: (id) => hasT(id, '글로잉 던'), dest: 'hand', label: '패에 추가할 「글로잉 던」 카드' }, { pred: any, dest: 'tamer', tp: stkTraitPred('글로잉 던'), fd: true, label: '「글로잉 던」 테이머 아래에 뒷면으로 놓을 카드', stackPrompt: '카드를 놓을 「글로잉 던」 테이머 선택' }] })]);
H('ST24-04', ['이동 시'], [R({ steps: [{ pred: (id) => hasT(id, '세이버즈'), dest: 'hand', label: '패에 추가할 「세이버즈」 카드' }, { pred: (id) => hasT(id, '세이버즈'), dest: 'tamer', tp: stkTraitPred('세이버즈'), fd: true, label: '「세이버즈」 테이머 아래에 뒷면으로 놓을 「세이버즈」 카드', stackPrompt: '카드를 놓을 「세이버즈」 테이머 선택' }] })]);
// ---- BT26-084 【링크했을 때】: 특징 「세븐 코드」 1장을 지불하는 코스트 -3으로 등장/사용할 수 있다. 나머지 덱 위 또는 아래
H('BT26-084', ['자신의 턴'], [R({ restTo: 'either', steps: [{ pred: (id) => hasT(id, '세븐 코드'), dest: 'play', delta: -3, allowOption: true, optional: true, label: '코스트 -3으로 등장/사용할 「세븐 코드」 카드' }] })]);

// ---- event triggers the generic watcher parser does not model (verify-reveal-3): each fires the printed segment (compiled generically / the scripts above) on its event
const HK = (id, d) => { (HOOKS[id] ||= []).push(d); };
const onSelfLinked = (state, hp, holder, info) => info.stack === holder && info.owner === hp;
HK('BT26-063', { tag: '자신의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } }); // 링크했을 때: 3장 오픈 (generic revealPick)
HK('BT26-084', { tag: '자신의 턴', has: '이 디지몬이 링크했을 때', limit: 1, events: { linked: onSelfLinked } });
HK('BT22-067', { tag: '서로의 턴', has: '디지몬이 플레이어에게 어택했을 때', limit: 1, events: { attackTarget: (state, hp, holder, info) => info.targetKind === 'player' } }); // either side's digimon attacking a player
HK('BT24-005', { tag: '자신의 턴', src: 'inheritedKo', has: '진화원에 테이머 카드가 놓여졌을 때', limit: 1, events: { sourcesAdded: (state, hp, holder, info) => info.stack === holder && info.owner === hp && (info.added || []).some((id) => C(id).category === 'tamer') } });
