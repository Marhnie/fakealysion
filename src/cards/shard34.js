// Shard 34 — batch-4 verification fixes (BT10-/BT11-/BT12- cards). Per-card scripts/hooks found wrong by the per-card audit (docs/verify-sets-BT10-12.md).
import * as S from '../state.js';

export const SCRIPTS = {};
export const OPS = {};
export const HOOKS = {};

const opp = (p) => (p === 'p1' ? 'p2' : 'p1');
const C = (id) => S.card(id);
const findStack = (state, p, uid) => { const pl = state.players[p]; return pl.raising?.uid === uid ? pl.raising : pl.battle.find(s => s.uid === uid) || null; };
const me = (ctx) => findStack(ctx.state, ctx.self, ctx.sourceStackUid);
const fn = (f) => ({ op: 's34_fn', fn: f });
OPS.s34_fn = async (instr, ctx, R) => { await instr.fn(ctx, R); };
const sc = (key, f) => { SCRIPTS[key] = [fn(f)]; };
const hk = (id, d) => { (HOOKS[id] ||= []).push(d); };
const fd = (st) => S.fdCount(st);

// ---- shared helpers
async function ops(ctx, R, list) { for (const o of list) await R.runOne(o, ctx); }
const hasTrait = (c, ...ts) => (c.types || []).some(t => ts.includes(t));
const namesOf = (id) => S.cardNames ? S.cardNames(id) : [C(id).nameKo];
const srcHasName = (st, ...ns) => st.sources.slice(fd(st)).some(id => namesOf(id).some(n => ns.includes(n)));
// 「패 또는 테이머 아래에서 <조건> 디지몬 카드 1장을 이 디지몬의 진화원 아래에 놓을 수 있다」 (optional; face-down cards under a Tamer are unknown and not offered). Returns true when a card was placed.
async function placeUnderFromHandOrTamer(ctx, st, pred, label) {
  const pl = ctx.state.players[ctx.self];
  const entries = [];
  pl.hand.forEach((id, i) => { if (C(id).category === 'digimon' && pred(C(id))) entries.push({ zone: 'hand', i, id }); });
  for (const t of pl.battle) if (C(t.cardId).category === 'tamer') t.sources.forEach((id, i) => { if (i >= fd(t) && C(id).category === 'digimon' && pred(C(id))) entries.push({ zone: 'tamer', i, id, t }); });
  if (!entries.length) return false;
  const k = await ctx.choose('multipleChoice', { prompt: `${label}: 이 디지몬의 진화원 아래에 놓을 카드 선택 (놓지 않음 가능)`, options: [...entries.map(e => `${C(e.id).nameKo} (${e.zone === 'hand' ? '패' : '테이머 아래'})`), '놓지 않음'] });
  if (k == null || k >= entries.length) return false;
  const e = entries[k];
  if (e.zone === 'hand') pl.hand.splice(e.i, 1); else { e.t.sources.splice(e.i, 1); S.recomputeStackGrants(e.t); }
  st.sources.splice(fd(st), 0, e.id);
  S.recomputeStackGrants(st);
  S.log(ctx.state, `${ctx.self} ${C(e.id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
  return true;
}
const CH = (c) => hasTrait(c, '크로스 하트');

// BT10-001 푸치메라몬 (진화원) 【자신의 턴】 이 디지몬의 진화원에 레드 이외의 카드가 있는 동안 DP+1000 — the printed condition was never evaluated (generic parser ignored it)
hk('BT10-001', { tag: '자신의 턴', src: 'inheritedKo', dp: (state, hp, h, target) => target === h && h.sources.slice(fd(h)).some(id => !(C(id).colors || []).includes('red')) ? 1000 : 0 });

// BT10-012 샤우트몬X4B / BT10-015 샤우트몬X5B — 【등장 시】【진화 시】 패 또는 테이머 아래의 「크로스 하트」 디지몬 1장을 진화원 아래에 놓을 수 있다. 그 후 진화원에 「베르제브몬」이 있을 때 …
sc('BT10-012::등장 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  await placeUnderFromHandOrTamer(ctx, st, CH, '「크로스 하트」 디지몬 카드');
  if (!srcHasName(st, '베르제브몬')) return;
  for (let i = 0; i < 2; i++) await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { traitAny: ['크로스 하트'] } }, ctx);
});
sc('BT10-015::등장 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  await placeUnderFromHandOrTamer(ctx, st, CH, '「크로스 하트」 디지몬 카드');
  if (!srcHasName(st, '베르제브몬')) return;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['크로스 하트'], levelMax: 4 }, rested: false, noTriggers: false, optional: true }, ctx);
});

// BT10-068 간쿠몬 X항체 【진화 시】 — the compiled script dropped "상대의 효과로 패, 덱으로 돌아가지 않으며, DP가 마이너스되지 않는다"
sc('BT10-068::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'any', filter: { category: 'digimon', nameAny: ['시스터몬'] }, rested: false, noTriggers: false, optional: true }, ctx);
  const pl = ctx.state.players[ctx.self];
  const cond = srcHasName(st, '간쿠몬') || pl.battle.some(s => C(s.cardId).category === 'digimon' && C(s.cardId).nameKo.includes('시스터몬'));
  if (!cond) return;
  const until = ctx.state.activePlayer === ctx.self ? ctx.state.turnNumber + 1 : ctx.state.turnNumber;
  await R.runOne({ op: 'modifyDPAll', target: 'self', amount: 2000, duration: 'nextOpponentTurn' }, ctx);
  for (const s of pl.battle.filter(x => C(x.cardId).category === 'digimon')) {
    S.grantShield(ctx.state, ctx.self, s.uid, { kinds: ['bounce'], until });
    (s.s1 = s.s1 || {}).noNegDP = until;
  }
});

// BT10-025 사이버드라몬 〔패〕【메인】 특징 「블루 플레어」 자신의 디지몬이 있을 때, 3 코스트 지불하고 이 카드를 그 디지몬 1마리의 진화원 아래에 놓는다. 그 후 그 디지몬을 액티브로 한다.
// (the generic compile dropped "이 카드를 … 진화원 아래에 놓는다" entirely and never picked the digimon)
sc('BT10-025::메인', async (ctx) => {
  const pl = ctx.state.players[ctx.self];
  let hi = ctx.trigger?.zoneIdx != null && pl.hand[ctx.trigger.zoneIdx] === ctx.sourceCardId ? ctx.trigger.zoneIdx : pl.hand.indexOf(ctx.sourceCardId);
  if (hi < 0) return;
  const tg = pl.battle.filter(s => C(s.cardId).category === 'digimon' && S.effectiveInfo(ctx.state, s, ctx.self).hasTrait('블루 플레어'));
  if (!tg.length) return;
  const uid = tg.length === 1 ? tg[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: tg.map(s => s.uid), prompt: '이 카드를 진화원 아래에 놓을 「블루 플레어」 디지몬 선택' });
  const t = tg.find(s => s.uid === uid); if (!t) return;
  S.spendMemory(ctx.state, 3);
  hi = pl.hand.indexOf(ctx.sourceCardId); if (hi < 0) return;
  const [id] = pl.hand.splice(hi, 1);
  t.sources.splice(fd(t), 0, id);
  S.recomputeStackGrants(t);
  S.log(ctx.state, `${ctx.self} ${C(id).nameKo}을(를) ${C(t.cardId).nameKo}의 진화원 아래에 놓음`);
  S.unsuspendStack(ctx.state, ctx.self, t.uid);
});

// ================= continuous / event hooks (BT10-/BT11-/BT12-) =================
const isDig = (st) => !!st && C(st.cardId).category === 'digimon';
const ownerOf = (state, st) => ['p1', 'p2'].find(p => state.players[p].battle.includes(st) || state.players[p].raising === st) || null;
const digsOf = (state, p) => state.players[p].battle.filter(isDig);
const trIncl = (id, ...ts) => (C(id).types || []).some(t => ts.some(x => t.includes(x)));
const trIs = (id, ...ts) => (C(id).types || []).some(t => ts.includes(t));
const nameIs = (id, ...ns) => S.cardNames(id).some(n => ns.includes(n));

// BT11-008 / BT11-010 / BT11-014 (진화원) 【자신의 턴】〔턴에 1회〕 이 디지몬의 어택의 대상이 변경되었을 때 — the generic watcher only knew "자신의 디지몬의 어택의 대상이 변경"
for (const id of ['BT11-008', 'BT11-010', 'BT11-014']) hk(id, { tag: '자신의 턴', src: 'inheritedKo', has: '어택의 대상이 변경', limit: 1, events: { redirect: (state, hp, h, i) => i.owner === hp && i.stack === h } });

// BT10-056 로터스몬 【상대의 턴】 특징 「식물형」/「요정형」을 포함하는 자신의 다른 디지몬 전부는 「【소멸 시】 메모리+2, 트래시의 DP 3000 이하 디지몬 카드 1장을 패로」의 효과를 얻는다.
hk('BT10-056', { tag: '상대의 턴', has: '소멸 시】 메모리+2', events: { delete: (state, hp, h, i) => i.owner === hp && !!i.stack && i.stack !== h && isDig(i.stack) && trIncl(i.stack.cardId, '식물형', '요정형') } });
sc('BT10-056::상대의 턴', async (ctx, R) => {
  S.grantMemory(ctx.state, ctx.self, 2, ctx.sourceCardId);
  await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { category: 'digimon', dpMax: 3000 } }, ctx);
});

// BT10-057 블룸로드몬 【자신의 턴】 레스트 상태의 자신의 디지몬 2마리마다 DP+2000 하고 《S 어택 +1》을 얻는다
const restedOwn = (state, p) => digsOf(state, p).filter(s => s.suspended).length;
hk('BT10-057', { tag: '자신의 턴', has: '2마리마다', dp: (state, hp, h, t) => (t === h ? Math.floor(restedOwn(state, hp) / 2) * 2000 : 0), kwNum: (state, hp, h) => Math.floor(restedOwn(state, hp) / 2) });
// BT11-019 샤우트몬X7 【서로의 턴】 이 디지몬의 진화원 2장마다 DP+1000
hk('BT11-019', { tag: '서로의 턴', has: '진화원 2장마다', dp: (state, hp, h, t) => (t === h ? Math.floor(h.sources.length / 2) * 1000 : 0) });
// BT11-078 소울몬 【서로의 턴】 《길동무》를 가진 자신의 디지몬 전부를 DP+2000
hk('BT11-078', { tag: '서로의 턴', has: '전부를 DP', dp: (state, hp, h, t) => (isDig(t) && ownerOf(state, t) === hp && S.hasKeyword(t, '길동무') ? 2000 : 0) });

// (BT11-041 / BT11-111 "소멸하지/벗어나지 않는다" are covered by the generic printed-survive parser in state.js — verified.)
// BT11-065 스내치몬 (진화원) 【서로의 턴】〔턴에 1회〕 이 디지몬의 진화원에서 「벰몬」이 덱 아래로 되돌아갔을 때 — 이 디지몬을 액티브로 하고, 상대의 턴 종료까지 《블로커》를 얻는다
hk('BT11-065', { tag: '서로의 턴', src: 'inheritedKo', has: '덱 아래로 되돌아갔을', limit: 1, events: { b4SourceToDeckBottom: (state, hp, h, i) => i.owner === hp && i.stack === h && (i.ids || []).some(id => nameIs(id, '벰몬')) } });

// BT11-042 엔젤우몬 / BT11-083 레이디데블몬 — 【자신의 턴】〔턴에 1회〕 자신의 「A」/「미카구라 미레이」가 등장했을 때, 메모리 +1
const playedNamed = (...ns) => (state, hp, h, i) => i.owner === hp && !!i.stack && nameIs(i.stack.cardId, ...ns);
hk('BT11-042', { tag: '자신의 턴', has: '등장했을 때', limit: 1, events: { play: playedNamed('레이디데블몬', '미카구라 미레이') } });
hk('BT11-083', { tag: '자신의 턴', has: '등장했을 때', limit: 1, events: { play: playedNamed('엔젤우몬', '미카구라 미레이') } });
// BT11-042 (진화원) 【상대의 턴】 퍼플인 자신의 디지몬이 있는 동안, 특징 「천사형」/「대천사형」/「타천사형」을 가진 자신의 디지몬 전부는 《블로커》를 얻는다 / BT11-083 (진화원) 옐로인 …《길동무》
const ANGEL = ['천사형', '대천사형', '타천사형'];
hk('BT11-042', { tag: '상대의 턴', src: 'inheritedKo', has: '《블로커》를 얻는다', grantKw: (state, hp, h, t) => (isDig(t) && ownerOf(state, t) === hp && trIs(t.cardId, ...ANGEL) && digsOf(state, hp).some(s => (S.effectiveInfo(state, s, hp).colors || C(s.cardId).colors).includes('purple')) ? ['블로커'] : []) });
hk('BT11-083', { tag: '상대의 턴', src: 'inheritedKo', has: '《길동무》를 얻는다', grantKw: (state, hp, h, t) => (isDig(t) && ownerOf(state, t) === hp && trIs(t.cardId, ...ANGEL) && digsOf(state, hp).some(s => (S.effectiveInfo(state, s, hp).colors || C(s.cardId).colors).includes('yellow')) ? ['길동무'] : []) });

// BT11-112 시노미야 리나 【자신의 턴】〔턴에 1회〕 블루인 자신의 디지몬이 액티브 상태가 되었을 때, 메모리 +1
const blueActive = (state, hp, h, i) => i.owner === hp && !!i.stack && isDig(i.stack) && (C(i.stack.cardId).colors || []).includes('blue');
hk('BT11-112', { tag: '자신의 턴', has: '액티브 상태가 되었을 때', limit: 1, events: { active: blueActive, unsuspend: blueActive } });

// BT10-057 블룸로드몬 【진화 시】 자신의 디지몬 1마리를 레스트시킬 수 있다. 그 후, 특징 「식물형」/「요정형」을 포함하는 레스트 상태인 자신의 디지몬 1마리마다 메모리+1.
// 이 효과로 메모리+2 이상 했을 때, 이 디지몬을 액티브로 하고 이 턴 동안 《관통》. (the generic compile ran the "+2 이상" branch unconditionally as an extra +2 memory)
sc('BT10-057::진화 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  const cands = digsOf(ctx.state, ctx.self).filter(s => !s.suspended);
  if (cands.length) {
    const uid = await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt: '레스트시킬 자신의 디지몬 선택 (취소 = 레스트하지 않음)' });
    if (uid) S.restStack(ctx.state, ctx.self, uid, 'effect');
  }
  const n = digsOf(ctx.state, ctx.self).filter(s => s.suspended && trIncl(s.cardId, '식물형', '요정형')).length;
  if (n > 0) S.grantMemory(ctx.state, ctx.self, n, ctx.sourceCardId);
  if (n >= 2) {
    S.unsuspendStack(ctx.state, ctx.self, st.uid);
    S.grantKeyword(ctx.state, ctx.self, st.uid, '관통', 1, 'turn');
  }
});

// BT10-084 택티몬 【등장 시】 트래시의 「바그라군」 Lv.4 이하 2장까지를 코스트 없이 등장. 다음 상대 턴 종료까지 이 효과로 등장한 디지몬 전부는 《블로커》 — (compiled: a single picked digimon got it)
sc('BT10-084::등장 시', async (ctx, R) => {
  const pl = ctx.state.players[ctx.self];
  const before = new Set(pl.battle.map(s => s.uid));
  const one = { op: 'playFree', who: 'self', zone: 'trash', filter: { category: 'digimon', traitAny: ['바그라군'], levelMax: 4 }, rested: false, noTriggers: false, optional: true };
  await R.runOne(one, ctx);
  await R.runOne(one, ctx);
  for (const s of pl.battle.filter(x => !before.has(x.uid) && isDig(x))) S.grantKeyword(ctx.state, ctx.self, s.uid, '블로커', 1, 'nextOpponentTurn');
});

// BT10-069 다크나이트몬 X항체 【진화 시】 자신의 트래시에서 「다크나이트몬 X항체」 이외의 블랙/퍼플인 디지몬 카드 1장을 패로 되돌린다. 그 후 이 디지몬의 진화원에 「다크나이트몬」/「X항체」가 있을 때, 테이머 1명을 소멸시키고 이 디지몬을 액티브로 한다.
// (compiled: the return and the tamer deletion were dropped, only the unsuspend ran)
sc('BT10-069::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  await R.runOne({ op: 'returnFromTrash', who: 'self', filter: { category: 'digimon', colors: ['black', 'purple'], exclNames: ['다크나이트몬 X항체'] } }, ctx);
  if (!st.sources.slice(fd(st)).some(id => nameIs(id, '다크나이트몬', 'X항체'))) return;
  const entries = [];
  for (const p of ['p1', 'p2']) for (const s of ctx.state.players[p].battle) if (C(s.cardId).category === 'tamer') entries.push({ player: p, uid: s.uid });
  if (entries.length) {
    const pick = entries.length === 1 ? entries[0] : await ctx.choose('pickStackAnySide', { entries, prompt: '소멸시킬 테이머 1명 선택' });
    if (pick) S.deleteStack(ctx.state, pick.player, pick.uid, 'trash', pick.player === ctx.self ? 'ownEffect' : 'effect');
  }
  S.unsuspendStack(ctx.state, ctx.self, st.uid);
});

// BT11-071 무소나이트몬 【등장 시】【진화 시】 자신의 패/트래시에서 명칭에 「나이트몬」을 포함하거나 특징 「바그라군」을 가진 디지몬 카드 1장을 이 디지몬의 진화원 위에 놓을 수 있다. 그 후 이 디지몬의 진화원에 「츠와몬」이 있다면 상대의 디지몬 3마리를 《퇴화 1》.
// (compiled: the placement on TOP of the sources was dropped)
sc('BT11-071::등장 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  const pl = ctx.state.players[ctx.self];
  const ok = (id) => C(id).category === 'digimon' && (C(id).nameKo.includes('나이트몬') || trIs(id, '바그라군'));
  const entries = [];
  pl.hand.forEach((id, i) => { if (ok(id)) entries.push({ zone: 'hand', i, id }); });
  pl.trash.forEach((id, i) => { if (ok(id)) entries.push({ zone: 'trash', i, id }); });
  if (entries.length) {
    const k = await ctx.choose('multipleChoice', { prompt: '이 디지몬의 진화원 위에 놓을 카드 선택 (놓지 않음 가능)', options: [...entries.map(e => `${C(e.id).nameKo} (${e.zone === 'hand' ? '패' : '트래시'})`), '놓지 않음'] });
    if (k != null && k < entries.length) {
      const e = entries[k];
      pl[e.zone].splice(e.i, 1);
      st.sources.push(e.id); // top of the sources
      S.recomputeStackGrants(st);
      S.log(ctx.state, `${ctx.self} ${C(e.id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 위에 놓음`);
      S.emitGameEvent(ctx.state, 'sourcesAdded', { owner: ctx.self, stack: st, cause: 'effect', srcPlayer: ctx.self });
    }
  }
  if (!st.sources.slice(fd(st)).some(id => nameIs(id, '츠와몬'))) return;
  const oppDigs = digsOf(ctx.state, ctx.opp).slice();
  const picked = new Set();
  for (let i = 0; i < 3; i++) {
    const cands = oppDigs.filter(s => !picked.has(s.uid));
    if (!cands.length) break;
    const uid = cands.length === 1 ? cands[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: cands.map(s => s.uid), prompt: `《퇴화 1》 상대 디지몬 선택 (${i + 1}/3, 서로 다른 디지몬)` });
    if (!uid) break;
    picked.add(uid);
    S.retreat(ctx.state, ctx.opp, uid, 1);
  }
});
SCRIPTS['BT11-071::진화 시'] = SCRIPTS['BT11-071::등장 시'];

// BT10-112 제스몬GX 【진화 시】 패/트래시의 「로얄 나이츠」 등장 코스트 13 이하 카드 1장을 이 디지몬의 진화원 아래에 놓을 수 있다. 놓은 카드의 【진화 시】 효과 1개를 이 디지몬의 효과로써 발휘한다. 그 후 《진격》.
// (compiled: only the 《진격》 ran — the placement and the borrowed effect were dropped)
sc('BT10-112::진화 시', async (ctx, R) => {
  const st = me(ctx); if (!st) return;
  const pl = ctx.state.players[ctx.self];
  const okc = (id) => trIs(id, '로얄 나이츠') && (C(id).cost ?? 99) <= 13;
  const entries = [];
  pl.hand.forEach((id, i) => { if (okc(id)) entries.push({ zone: 'hand', i, id }); });
  pl.trash.forEach((id, i) => { if (okc(id)) entries.push({ zone: 'trash', i, id }); });
  let placed = null;
  if (entries.length) {
    const k = await ctx.choose('multipleChoice', { prompt: '이 디지몬의 진화원 아래에 놓을 「로얄 나이츠」 카드 선택 (놓지 않음 가능)', options: [...entries.map(e => `${C(e.id).nameKo} (${e.zone === 'hand' ? '패' : '트래시'})`), '놓지 않음'] });
    if (k != null && k < entries.length) {
      const e = entries[k];
      pl[e.zone].splice(e.i, 1);
      st.sources.splice(fd(st), 0, e.id);
      S.recomputeStackGrants(st);
      S.log(ctx.state, `${ctx.self} ${C(e.id).nameKo}을(를) ${C(st.cardId).nameKo}의 진화원 아래에 놓음`);
      placed = e.id;
    }
  }
  if (placed) {
    const Fx = await import('../effects.js');
    const segs = S.parseEffectSegments(C(placed).effectKo || '').segments.filter(sg => sg.tags.some(t => t.includes('진화 시')));
    if (segs.length) {
      let seg = segs[0];
      if (segs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map(sg => sg.body.replace(/\n/g, ' ').slice(0, 60)) }); if (k != null) seg = segs[k]; }
      const script = Fx.lookupCardSpecific(placed, seg.tags, seg.body) || Fx.compileToScript(seg.body);
      if (script && script.length) await R.runScript(script, { ...ctx, sourceCardId: placed });
      else S.log(ctx.state, `${C(placed).nameKo} 【진화 시】 효과를 자동 처리할 수 없음: ${seg.body}`);
    }
  }
  await R.runOne({ op: 'grantKeyword', target: 'self', thisStack: true, keyword: '진격', duration: 'turn', _bare: true }, ctx);
  await R.runOne({ op: 'raid' }, ctx);
});

// BT11-028 마하가오가몬 【진화 시】 상대의 턴 종료까지 이 디지몬은 《블로커》를 얻고, 상대의 패 4장마다 이 디지몬을 DP+2000 — (compiled: a flat +2000 without the per-4-cards count)
sc('BT11-028::진화 시', async (ctx) => {
  const st = me(ctx); if (!st) return;
  S.grantKeyword(ctx.state, ctx.self, st.uid, '블로커', 1, 'opponentTurn');
  const n = Math.floor(ctx.state.players[ctx.opp].hand.length / 4);
  if (n > 0) S.modifyDP(ctx.state, ctx.self, st.uid, 2000 * n, 'opponentTurn');
});

// BT11-034 큐트몬 【등장 시】 트래시의 「크로스 하트」 디지몬 1장을 자신의 테이머 아래에 놓는다. 명칭에 「도루루몬」을 포함하거나 진화원에 「도루루몬」을 가진 자신의 디지몬이 있다면 대신 2장까지를 자신의 테이머 1명 아래에 놓는다.
// (compiled: the "대신 2장까지" branch was empty)
sc('BT11-034::등장 시', async (ctx, R) => {
  const alt = digsOf(ctx.state, ctx.self).some(s => C(s.cardId).nameKo.includes('도루루몬') || s.sources.slice(fd(s)).some(id => nameIs(id, '도루루몬')));
  await R.runOne({ op: 'placeUnderTamer', who: 'self', zones: ['trash'], filter: { category: 'digimon', traitAny: ['크로스 하트'] }, n: alt ? 2 : 1 }, ctx);
});

// BT11-055 메탈티라노몬 【등장 시】【진화 시】 그린/블랙인 자신의 테이머 1명마다 상대의 디지몬 1마리를 레스트시킨다. 그 후, 레스트 상태인 상대의 디지몬 「1마리」는 다음 상대의 액티브 페이즈에서는 액티브가 되지 않는다.
// (compiled: the no-unsuspend flag was put on EVERY digimon rested by the per-tamer loop)
sc('BT11-055::등장 시', async (ctx, R) => {
  const n = ctx.state.players[ctx.self].battle.filter(s => C(s.cardId).category === 'tamer' && (S.effectiveInfo(ctx.state, s, ctx.self).colors || C(s.cardId).colors).some(c => c === 'green' || c === 'black')).length;
  for (let i = 0; i < n; i++) await R.runOne({ op: 'rest', target: 'opponent', n: 1, digimonOnly: true }, ctx);
  const rested = digsOf(ctx.state, ctx.opp).filter(s => s.suspended);
  if (!rested.length) return;
  const uid = rested.length === 1 ? rested[0].uid : await ctx.choose('pickStack', { player: ctx.self, uids: rested.map(s => s.uid), prompt: '다음 액티브 페이즈에 액티브가 되지 않을 레스트 상태의 상대 디지몬 1마리 선택' });
  if (uid) S.setSkipNextUnsuspend(ctx.state, ctx.opp, uid);
});

// BT11-059 러스트티라노몬 (패의 이 카드) 자신의 디지몬이 이 카드로 진화할 때, 그린/블랙인 자신의 테이머 1명마다 지불하는 진화 코스트 -1 — printed on the card being evolved INTO (no tag): was never applied
hk('BT11-059', { selfEvoDiscount: (state, p) => -state.players[p].battle.filter(s => C(s.cardId).category === 'tamer' && (S.effectiveInfo(state, s, p).colors || C(s.cardId).colors).some(c => c === 'green' || c === 'black')).length });

// BT11-088 바그라몬 【서로의 턴】〔턴에 1회〕 상대의 디지몬이 진화했을 때, 또는 상대의 디지몬의 진화원이 효과로 늘어났을 때, 이 디지몬의 진화원을 선택하여 1장 파기하는 것으로 상대의 시큐리티를 위에서부터 1장 파기한다.
// (the generic watcher only knew the "진화했을 때" half and asked for the cost by hand)
hk('BT11-088', { tag: '서로의 턴', has: '상대의 디지몬이 진화했을 때', limit: 1, events: {
  digivolve: (state, hp, h, i) => i.owner !== hp && !!i.stack && isDig(i.stack),
  sourcesAdded: (state, hp, h, i) => i.owner !== hp && !!i.stack && isDig(i.stack) && i.cause === 'effect',
} });
SCRIPTS['BT11-088::서로의 턴'] = [{ op: 's2_costSource', pred: () => true, prompt: '파기할 이 디지몬의 진화원 1장 선택', optional: true, confirm: '진화원 1장을 파기하고 상대의 시큐리티 1장을 파기할까요?', then: [{ op: 'removeSecurity', who: 'opponent', position: 'top' }] }];

// BT11-094 미카구라 미레이 【자신의 턴】 자신의 디지몬이 「엔젤우몬」/「레이디데블몬」으로 진화했을 때, 자신의 디지몬이 1마리 이하라면, 이 테이머를 레스트시키는 것으로, 자신의 패에서 「레이디데블몬」/「엔젤우몬」 중 진화한 디지몬과 명칭이 서로 다른 1장을 코스트 없이 등장시킬 수 있다.
// (compiled: the "명칭이 서로 다른" descriptor was not understood, so any hand card could be played)
sc('BT11-094::자신의 턴', async (ctx, R) => {
  const tamer = me(ctx); if (!tamer || tamer.suspended) return;
  const pl = ctx.state.players[ctx.self];
  if (digsOf(ctx.state, ctx.self).length > 1) return;
  const evUid = ctx.trigger?.evtStackUid;
  const ev = evUid ? pl.battle.find(s => s.uid === evUid) : null;
  const evName = ev ? (['엔젤우몬', '레이디데블몬'].find(n => nameIs(ev.cardId, n)) || null) : null;
  if (!evName) return;
  const other = evName === '엔젤우몬' ? '레이디데블몬' : '엔젤우몬';
  if (!pl.hand.some(id => C(id).category === 'digimon' && nameIs(id, other))) return;
  if (!(await ctx.choose('confirmEffect', { player: ctx.self, prompt: `이 테이머를 레스트시키고 패의 「${other}」를 코스트 없이 등장시킬까요?` }))) return;
  S.restStack(ctx.state, ctx.self, tamer.uid, 'effect');
  if (!tamer.suspended) return;
  await R.runOne({ op: 'playFree', who: 'self', zone: 'hand', filter: { category: 'digimon', exactAny: [other] }, rested: false, noTriggers: false, optional: true }, ctx);
});

// BT11-112 시노미야 리나 【서로의 턴】 명칭에 「브이드라몬」을 포함하는 자신의 디지몬이 레스트했을 때, 이 테이머를 레스트시키는 것으로, 그 디지몬의 【진화 시】 효과 1개를 발휘한다.
// (compiled: the borrowed 【진화 시】 effect was dropped — the tamer was rested for nothing)
sc('BT11-112::서로의 턴', async (ctx, R) => {
  // (the pending item is queued by the generic watcher, which already rested this Tamer as the cost)
  const pl = ctx.state.players[ctx.self];
  const evUid = ctx.trigger?.evtStackUid;
  const dg = evUid ? pl.battle.find(s => s.uid === evUid) : null;
  if (!dg || !isDig(dg) || !C(dg.cardId).nameKo.includes('브이드라몬')) return;
  const segs = S.parseEffectSegments(C(dg.cardId).effectKo || '').segments.filter(sg => sg.tags.some(t => t.includes('진화 시')));
  if (!segs.length) return;
  let seg = segs[0];
  if (segs.length > 1) { const k = await ctx.choose('multipleChoice', { prompt: '발휘할 【진화 시】 효과 선택', options: segs.map(sg => sg.body.replace(/\n/g, ' ').slice(0, 60)) }); if (k != null) seg = segs[k]; }
  const Fx = await import('../effects.js');
  const script = Fx.lookupCardSpecific(dg.cardId, seg.tags, seg.body) || Fx.compileToScript(seg.body);
  if (script && script.length) await R.runScript(script, { ...ctx, sourceCardId: dg.cardId, sourceStackUid: dg.uid });
  else S.log(ctx.state, `${C(dg.cardId).nameKo} 【진화 시】 효과를 자동 처리할 수 없음: ${seg.body}`);
});
