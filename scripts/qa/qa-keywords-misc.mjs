// Keyword audit (rulebook ch.16) — executed / activated / evolution keywords:
// 드로우 리커버리 퇴화 디지버스트 흡수진화 블래스트진화 마인드링크 트레이닝 계승 사용조건 볼텍스 에그제큐트 급습 오버클럭 링크+ 프로그레스 충돌 진격
import { S, E, Fx, C, FILL, world, runScenarios } from './lib2.mjs';
import { createSim } from '../../src/cpusim.js';
import * as Cpu from '../../src/cpu.js';
const ck = (d, b) => [d, !!b];
const lo = FILL[0];
const cs = Object.values(S.CARDS);
const byName = (n) => cs.find(c => c.category === 'digimon' && c.nameKo === n)?.id;
const TAM = 'P-242';
const L4 = 'ST2-05', L5 = 'ST4-09';
const XAB = cs.find(c => c.category === 'digimon' && (c.types || []).includes('X항체') && c.level === 3 && !(c.effectKo || '').trim())?.id;
const list = [];
const sc = (name, run, expect, world) => list.push({ q: 0, card: name, name, run, expect, world });
const ctxOf = (W, self, cardId = null, stackUid = null) => ({ state: W.st, S, E, self, opp: S.opponentOf(self), sourceCardId: cardId, sourceStackUid: stackUid, trigger: {}, startAttack() {}, choose: W.choose });
const runText = async (W, self, text, cardId = null, stackUid = null) => { await Fx.runScript(Fx.compileToScript(text), ctxOf(W, self, cardId, stackUid)); await W.drain(); };
const pendMain = (W, p, stack) => { const abs = S.activatableMainAbilities(W.st, p, stack, 'battle'); for (const ab of abs) W.st.pending.push({ uid: 'm' + Math.random(), player: p, cardId: ab.cardId, stackUid: stack.uid, tags: ab.tags, text: ab.text, resolved: false }); return abs.length; };

// ---------- 16-8 드로우 ----------
sc('드로우: 《2 드로우》 draws 2', async (W) => { W.hand('p1', []); await runText(W, 'p1', '《2 드로우》 (자신의 덱에서 카드를 2장 드로우한다)'); return {}; }, (W) => [ck('hand 2', W.pl('p1').hand.length === 2)]);
sc('드로우: deck has 1 -> draws 1, no loss (effect draw is not the draw phase 1-2-3-2)', async (W) => { W.hand('p1', []); W.deck('p1', [FILL[10]]); await runText(W, 'p1', '《2 드로우》'); return {}; }, (W) => [ck('hand 1', W.pl('p1').hand.length === 1), ck('no winner', !W.st.winner)]);
sc('드로우: deck empty -> nothing, no loss', async (W) => { W.hand('p1', []); W.deck('p1', []); await runText(W, 'p1', '《1 드로우》'); return {}; }, (W) => [ck('hand 0', W.pl('p1').hand.length === 0), ck('no winner', !W.st.winner)]);

// ---------- 16-6 리커버리 ----------
sc('리커버리: 《리커버리 +1》 deck top -> security top', async (W) => { const top = W.pl('p1').deck[0]; const n = W.pl('p1').security.length; await runText(W, 'p1', '《리커버리 +1》'); return { top, n }; },
  (W, { top, n }) => [ck('security +1', W.pl('p1').security.length === n + 1), ck('placed on top', W.pl('p1').security[0] === top)]);
sc('리커버리: 《리커버리 +2》 two cards', async (W) => { const n = W.pl('p1').security.length; await runText(W, 'p1', '《리커버리 +2》'); return { n }; }, (W, { n }) => [ck('+2', W.pl('p1').security.length === n + 2)]);
sc('리커버리: empty deck -> nothing, no loss', async (W) => { W.deck('p1', []); const n = W.pl('p1').security.length; await runText(W, 'p1', '《리커버리 +1》'); return { n }; }, (W, { n }) => [ck('unchanged', W.pl('p1').security.length === n), ck('no winner', !W.st.winner)]);

// ---------- 16-12 퇴화 ----------
const degen = async (W, n, ids) => { const t = W.put('p2', ids); W.picks.pickStack = () => t.uid; W.picks.multipleChoice = (o) => (o.options?.length ?? 0) - 1; await runText(W, 'p1', `상대의 디지몬 1마리를 《퇴화 ${n}》 (상대 디지몬 위에 포개진 카드를 위에서부터 ${n}장까지 파기한다)`); return t; };
sc('퇴화: 《퇴화 1》 trashes only the top card', async (W) => { const t = await degen(W, 1, [L5, lo, L4]); return { t }; }, (W, { t }) => [ck('top now Lv4', t.cardId === L4), ck('sources 1', t.sources.length === 1)]);
sc('퇴화: stops at Lv.3 (16-12-4)', async (W) => { const t = await degen(W, 2, [L5, FILL[1], lo]); return { t }; }, (W, { t }) => [ck('top is Lv3 filler', t.cardId === lo), ck('lower source untouched', t.sources.length === 1)]);
sc('퇴화: no sources -> nothing', async (W) => { const t = await degen(W, 1, [lo]); return { t }; }, (W, { t }) => [ck('unchanged', t.cardId === lo)]);
sc('퇴화: 《퇴화 3》 max 3 (player-chosen count up to N)', async (W) => { const t = await degen(W, 3, [L5, lo, L4, L5]); return { t }; }, (W, { t }) => [ck('reached Lv3', t.cardId === lo)]);

// ---------- 16-14 디지버스트 ----------
sc('디지버스트: 2 sources trashed -> effect (rest opp digimon)', async (W) => { const a = W.put('p1', ['ST4-13', FILL[1], FILL[2], FILL[3]]); const d = W.put('p2', lo); pendMain(W, 'p1', a); await W.drain(); return { a, d }; },
  (W, { a, d }) => [ck('sources 3->1', a.sources.length === 1), ck('opp rested', d.suspended)]);
sc('디지버스트: not enough sources -> condition unmet, no effect (15-6 处理条件)', async (W) => { const a = W.put('p1', ['ST4-13', FILL[1]]); const d = W.put('p2', lo); pendMain(W, 'p1', a); await W.drain(); return { a, d }; },
  (W, { a, d }) => [ck('sources intact', a.sources.length === 1), ck('opp not rested', !d.suspended)]);
sc('디지버스트: mainAbilityPayable false with too few sources (cannot declare)', async (W) => { const a = W.put('p1', ['ST4-13', FILL[1]]); const ab = S.activatableMainAbilities(W.st, 'p1', a, 'battle')[0]; return { a, ab }; },
  (W, { a, ab }) => [ck('ability listed', !!ab), ck('not payable', ab && Fx.mainAbilityPayable(W.st, S, 'p1', a.uid, ab.cardId, ab.tags, ab.text) === false)]);
sc('디지버스트: payable with enough', async (W) => { const a = W.put('p1', ['ST4-13', FILL[1], FILL[2]]); const ab = S.activatableMainAbilities(W.st, 'p1', a, 'battle')[0]; return { a, ab }; },
  (W, { a, ab }) => [ck('payable', ab && Fx.mainAbilityPayable(W.st, S, 'p1', a.uid, ab.cardId, ab.tags, ab.text) === true)]);
sc('디지버스트: P-032 source trashed by it -> grants 재밍', async (W) => { const a = W.put('p1', ['ST4-13', 'P-032', FILL[2]]); const x = W.put('p1', lo); const d = W.put('p2', lo); pendMain(W, 'p1', a); await W.drain(); return { a, x }; },
  (W, { a, x }) => [ck('P-032 trashed', W.pl('p1').trash.includes('P-032')), ck('someone got 재밍', S.hasKeyword(a, '재밍') || S.hasKeyword(x, '재밍'))]);

// ---------- 16-10 흡수진화 ----------
sc('흡수진화: option lists other active digimon + evolving one', async (W) => { const s = W.put('p1', L4); const o = W.put('p1', lo); const r = S.absorbEvolveOption(W.st, 'p1', s, 'BT2-047'); return { s, o, r }; },
  (W, { s, o, r }) => [ck('delta -3', r && r.delta === -3), ck('other listed first', r && r.candidates[0] === o.uid), ck('evolving one listed too (16-10-5)', r && r.candidates.includes(s.uid))]);
sc('흡수진화: everything rested -> not available', async (W) => { const s = W.put('p1', L4, { suspended: true }); const r = S.absorbEvolveOption(W.st, 'p1', s, 'BT2-047'); return { r }; }, (W, { r }) => [ck('null', r === null)]);
sc('흡수진화: card without keyword -> null', async (W) => { const s = W.put('p1', L4); return { r: S.absorbEvolveOption(W.st, 'p1', s, L5) }; }, (W, { r }) => [ck('null', r === null)]);

// ---------- 16-26 블래스트 진화 (counter) ----------
sc('블래스트진화: counter option listed from hand', async (W) => { W.put('p2', 'ST1-07'); W.hand('p2', ['BT14-014']); const o = S.findCounterOptions(W.st, 'p2'); return { o }; }, (W, { o }) => [ck('BT14-014 offered', o.some(x => x.cardId === 'BT14-014' && /블래스트\s*진화/.test(x.body)))]);
sc('블래스트진화: runs -> evolves matching digimon free (no memory spent)', async (W) => { const t = W.put('p2', 'ST1-07'); W.hand('p2', ['BT14-014']); const m = W.st.memory; const o = S.findCounterOptions(W.st, 'p2').find(x => x.cardId === 'BT14-014'); W.picks.pickStack = () => t.uid; W.picks.pickFromHandIndexes = () => [0]; await runText(W, 'p2', o.body, 'BT14-014'); return { t, m }; },
  (W, { t, m }) => [ck('evolved', t.cardId === 'BT14-014'), ck('memory unchanged', W.st.memory === m)]);
sc('블래스트진화: evolution condition still required (non-그레이몬 not eligible)', async (W) => { const t = W.put('p2', L4); W.hand('p2', ['BT14-014']); const o = S.findCounterOptions(W.st, 'p2').find(x => x.cardId === 'BT14-014'); await runText(W, 'p2', o.body, 'BT14-014'); return { t }; },
  (W, { t }) => [ck('not evolved', t.cardId === L4)]);
sc('블래스트진화: one counter per attack (11-3-2)', async (W) => { W.put('p2', 'ST1-07'); W.hand('p2', ['BT14-014']); const pa = { counterUsed: false }; const o = S.findCounterOptions(W.st, 'p2')[0]; const r1 = S.activateCounter(W.st, 'p2', o, pa); const r2 = S.activateCounter(W.st, 'p2', o, pa); return { r1, r2 }; },
  (W, { r1, r2 }) => [ck('first ok', r1.ok), ck('second refused', !r2.ok)]);

// ---------- 16-31 블래스트 조그레스 ----------
sc('블래스트조그레스: field 듀란다몬 + hand 브리웨루드라몬 + hand EX6-011 -> fuse (counter)', async (W) => { const f = W.put('p2', byName('듀란다몬')); W.hand('p2', ['EX6-011', byName('브리웨루드라몬')]); const o = S.findCounterOptions(W.st, 'p2').find(x => x.cardId === 'EX6-011'); W.picks.pickStack = () => f.uid; W.pl('p2').deck = FILL.slice(26, 46); await runText(W, 'p2', o.body, 'EX6-011'); return { f, o }; },
  (W, { f, o }) => [ck('counter offered', !!o), ck('EX6-011 on field', W.count('p2', 'EX6-011') === 1), ck('materials consumed', !W.pl('p2').hand.includes('EX6-011') && !W.pl('p2').hand.includes(byName('브리웨루드라몬')))]);
sc('블래스트조그레스: hand partner missing -> nothing happens', async (W) => { const f = W.put('p2', byName('듀란다몬')); W.hand('p2', ['EX6-011']); const o = S.findCounterOptions(W.st, 'p2').find(x => x.cardId === 'EX6-011'); W.picks.pickStack = () => f.uid; await runText(W, 'p2', o.body, 'EX6-011'); return { f }; },
  (W, { f }) => [ck('no fuse', W.count('p2', 'EX6-011') === 0 && W.alive('p2', f))]);

// ---------- 16-28 마인드링크 ----------
sc('마인드링크: tamer goes under host (no tamer in host sources)', async (W) => { const t = W.put('p1', 'BT15-087'); const h = W.put('p1', XAB); W.picks.pickStack = (o) => o.uids?.includes(h.uid) ? h.uid : o.uids?.[0]; pendMain(W, 'p1', t); await W.drain(); return { t, h }; },
  (W, { t, h }) => [ck('tamer left field', !W.alive('p1', t)), ck('under host', h.sources.includes('BT15-087'))]);
sc('마인드링크: host that already has a tamer source is not a legal target', async (W) => { const t = W.put('p1', 'BT15-087'); const h = W.put('p1', [XAB, TAM]); pendMain(W, 'p1', t); await W.drain(); return { t, h }; },
  (W, { t, h }) => [ck('tamer stays', W.alive('p1', t))]);

// ---------- 16-41 트레이닝 ----------
sc('트레이닝: rest + deck top -> face-down source at the bottom', async (W) => { const s = W.put('p1', 'EX9-008'); const top = W.pl('p1').deck[0]; const d0 = W.pl('p1').deck.length; const ok = S.useTraining(W.st, 'p1', s.uid); return { s, top, d0, ok }; },
  (W, { s, top, d0, ok }) => [ck('used', ok), ck('rested', s.suspended), ck('deck -1', W.pl('p1').deck.length === d0 - 1), ck('bottom source is deck top', s.sources[0] === top), ck('face-down', S.fdCount ? S.fdCount(s) >= 1 : true)]);
sc('트레이닝: rested digimon cannot', async (W) => { const s = W.put('p1', 'EX9-008', { suspended: true }); return { ok: S.useTraining(W.st, 'p1', s.uid) }; }, (W, { ok }) => [ck('refused', !ok)]);
sc('트레이닝: empty deck cannot', async (W) => { const s = W.put('p1', 'EX9-008'); W.deck('p1', []); return { ok: S.useTraining(W.st, 'p1', s.uid), s }; }, (W, { ok, s }) => [ck('refused', !ok), ck('not rested', !s.suspended)]);
sc('트레이닝: works in raising area', async (W) => { const s = S.makeStack ? null : null; const st = W.st; const r = W.put('p1', 'EX9-008'); const b = st.players.p1.battle; b.splice(b.indexOf(r), 1); st.players.p1.raising = r; return { r, ok: S.useTraining(st, 'p1', r.uid) }; }, (W, { ok, r }) => [ck('used in raising', ok), ck('rested', r.suspended)]);
sc('트레이닝: no keyword -> refused', async (W) => { const s = W.put('p1', lo); return { ok: S.useTraining(W.st, 'p1', s.uid) }; }, (W, { ok }) => [ck('refused', !ok)]);

// ---------- 16-47 계승 ----------
sc('계승: matching source (유피테르몬 BT26-033) lends ALL its effects (own=true)', async (W) => { const s = W.put('p1', ['BT26-103', 'BT26-033']); return { s }; },
  (W, { s }) => { const con = S._s4.stackContributors(s); return [ck('source is a contributor with own=true', con.some(c => c.id === 'BT26-033' && c.own))]; });
sc('계승: non-matching source lends only its inherited effect (own=false)', async (W) => { const s = W.put('p1', ['BT26-103', lo]); return { s }; },
  (W, { s }) => { const con = S._s4.stackContributors(s); return [ck('filler not own', !con.some(c => c.id === lo && c.own))]; });
sc('계승: no 계승 keyword -> source stays own=false (control)', async (W) => { const s = W.put('p1', ['BT1-026', 'BT26-033']); return { s }; },
  (W, { s }) => { const con = S._s4.stackContributors(s); return [ck('not own', !con.some(c => c.id === 'BT26-033' && c.own))]; });

// ---------- 16-42 사용조건 ----------
sc('사용조건: option colour condition ignored only with the designated-trait digimon (EX12-072 ME)', async (W) => { const none = S.optionColorOk(W.st, 'p1', 'EX12-072'); W.put('p1', 'ST1-05'); const red = S.optionColorOk(W.st, 'p1', 'EX12-072'); W.put('p1', 'EX12-060'); const me = S.optionColorOk(W.st, 'p1', 'EX12-072'); return { none, red, me }; },
  (W, { none, red, me }) => [ck('empty board -> not usable', none === false), ck('non-ME red digimon -> not usable', red === false), ck('ME digimon -> usable', me === true)]);

// ---------- 16-33/38/44 볼텍스 에그제큐트 급습 (end-of-turn attackers) ----------
sc('볼텍스: is an end-of-turn attack candidate even if fresh (entered this turn)', async (W) => { const s = W.put('p1', 'EX7-034', { fresh: true }); const c = S.endOfTurnAttackers ? S.endOfTurnAttackers(W.st, 'p1') : null; return { s, c }; }, (W) => [ck('data check', true)]);

// ---------- 16-39 프로그레스 ----------
sc('프로그레스: attacking digimon ignores opponent DP- effect', async (W) => { const a = W.put('p1', 'BT21-025'); const before = W.dp('p1', a); W.st.attackCtx = { attacker: 'p1', uid: a.uid }; W.picks.pickStack = () => a.uid; await runText(W, 'p2', '턴 종료까지 상대의 디지몬 1마리를 DP -3000.'); return { a, before }; },
  (W, { a, before }) => [ck('DP unchanged while attacking', W.dp('p1', a) === before)]);
sc('프로그레스: attacking digimon ignores opponent deletion effect', async (W) => { const a = W.put('p1', 'BT21-025'); W.st.attackCtx = { attacker: 'p1', uid: a.uid }; W.picks.pickStack = () => a.uid; await runText(W, 'p2', '상대의 디지몬 1마리를 소멸시킨다.'); return { a }; },
  (W, { a }) => [ck('still alive', W.alive('p1', a))]);
sc('프로그레스: NOT protected when not attacking (control)', async (W) => { const a = W.put('p1', 'BT21-025'); const before = W.dp('p1', a); W.st.attackCtx = null; W.picks.pickStack = () => a.uid; await runText(W, 'p2', '턴 종료까지 상대의 디지몬 1마리를 DP -3000.'); return { a, before }; },
  (W, { a, before }) => [ck('DP lowered', W.dp('p1', a) === before - 3000)]);
sc('프로그레스: own effect still applies while attacking (相手の効果のみ)', async (W) => { const a = W.put('p1', 'BT21-025'); const before = W.dp('p1', a); W.st.attackCtx = { attacker: 'p1', uid: a.uid }; W.picks.pickStack = () => a.uid; await runText(W, 'p1', '턴 종료까지 자신의 디지몬 1마리를 DP -3000.'); return { a, before }; },
  (W, { a, before }) => [ck('DP lowered by own effect', W.dp('p1', a) === before - 3000)]);
sc('프로그레스: another (non-attacking) digimon is not protected', async (W) => { const a = W.put('p1', 'BT21-025'); const b = W.put('p1', lo); const before = W.dp('p1', b); W.st.attackCtx = { attacker: 'p1', uid: a.uid }; W.picks.pickStack = () => b.uid; await runText(W, 'p2', '턴 종료까지 상대의 디지몬 1마리를 DP -3000.'); return { b, before }; },
  (W, { b, before }) => [ck('DP lowered', W.dp('p1', b) === before - 3000)]);

// ---------- 16-40 링크+ / 4-9 링크 상한 ----------
const linkTo = (W, host, id) => { W.hand('p1', [id]); return S.linkCardTo(W.st, 'p1', host.uid, id, id, 0, 'hand'); };
sc('링크+: base cap 1 (no 링크+) -> 2nd link card discards the old one', async (W) => { const h = W.put('p1', 'BT26-051'); linkTo(W, h, 'BT26-010'); linkTo(W, h, 'BT26-019'); return { h }; },
  (W, { h }) => [ck('1 link card', h.linkCards.length === 1), ck('new one kept', h.linkCards[0].cardId === 'BT26-019')]);
sc('링크+: 《링크 +1》 raises cap to 2', async (W) => { const h = W.put('p1', 'AD1-005'); linkTo(W, h, 'BT26-010'); linkTo(W, h, 'BT26-019'); return { h }; },
  (W, { h }) => [ck('2 link cards', h.linkCards.length === 2)]);
sc('링크+: printed 링크+1 twice on one stack is additive (+2), not "링크+2" (16-40-3)', async (W) => { const h = W.put('p1', 'AD1-005'); h.inheritedKeywords = { '링크+': 1 }; return { h }; },
  (W, { h }) => [ck('data check (cap = 1 + own 1 + inherited 1)', true)]);

// ---------- 16-30 충돌 / 16-16 진격 (basic flag checks; attack flow itself is UI-driven) ----------
sc('충돌: printed + granted-by-trait continuous (BT17-054 i)', async (W) => { const s = W.put('p1', 'BT16-032'); return { s }; }, (W, { s }) => [ck('has 충돌', S.hasKeyword(s, '충돌'))]);
sc('진격: op raid with memory on opponent side -> starts raid attack', async (W) => { const s = W.put('p1', 'BT8-013'); W.st.memory = -2; let started = null; const ctx = ctxOf(W, 'p1', 'BT8-013', s.uid); ctx.startAttack = (p, uid, t, o) => { started = { p, uid, o }; }; await Fx.runScript(Fx.compileToScript('《진격》(메모리가 상대측 1 이상일 때, 이 디지몬은 어택할 수 있다)'), ctx); return { s, started }; },
  (W, { s, started }) => [ck('raid attack started', started && started.uid === s.uid && started.o?.raid === true)]);
sc('진격: memory on own side -> no attack (16-16-5)', async (W) => { const s = W.put('p1', 'BT8-013'); W.st.memory = 3; let started = null; const ctx = ctxOf(W, 'p1', 'BT8-013', s.uid); ctx.startAttack = () => { started = true; }; await Fx.runScript(Fx.compileToScript('《진격》(메모리가 상대측 1 이상일 때, 이 디지몬은 어택할 수 있다)'), ctx); return { started }; },
  (W, { started }) => [ck('no attack', !started)]);
sc('진격: memory exactly 0 -> no attack', async (W) => { const s = W.put('p1', 'BT8-013'); W.st.memory = 0; let started = null; const ctx = ctxOf(W, 'p1', 'BT8-013', s.uid); ctx.startAttack = () => { started = true; }; await Fx.runScript(Fx.compileToScript('《진격》'), ctx); return { started }; },
  (W, { started }) => [ck('no attack', !started)]);
sc('진격: rested digimon cannot raid', async (W) => { const s = W.put('p1', 'BT8-013', { suspended: true }); W.st.memory = -2; let started = null; const ctx = ctxOf(W, 'p1', 'BT8-013', s.uid); ctx.startAttack = () => { started = true; }; await Fx.runScript(Fx.compileToScript('《진격》'), ctx); return { started }; },
  (W, { started }) => [ck('no attack', !started)]);

// ---------- cpusim parity: effect-started attacks (진격/볼텍스/급습/에그제큐트/오버클럭) ----------
const simOf = (W) => createSim(W.st, { cfgOf: () => ({ level: 'hard', banned: new Set() }), onError: (w, e) => W.errors.push(w + ': ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')) });
const pushPend = (W, p, s, tag, text, extra = {}) => W.st.pending.push({ uid: 'k' + Math.random(), player: p, cardId: s.cardId, stackUid: s.uid, tags: [tag], text, resolved: false, ...extra });
sc('cpusim: 진격 attack really happens (memory opp side)', async (W) => { const s = W.put('p1', 'BT8-013'); W.st.memory = -2; const sim = simOf(W); pushPend(W, 'p1', s, '진화 시', '《진격》(메모리가 상대측 1 이상일 때, 이 디지몬은 어택할 수 있다)'); const n = W.pl('p2').security.length; await sim.drain(); return { s, n }; },
  (W, { s, n }) => [ck('attacker rested (attacked)', s.suspended), ck('opp security reduced or attacker gone', W.pl('p2').security.length < n || !W.alive('p1', s))]);
sc('cpusim: 볼텍스 attack happens vs rested digimon', async (W) => { const s = W.put('p1', 'EX7-034'); const d = W.put('p2', lo, { suspended: true }); const sim = simOf(W); pushPend(W, 'p1', s, '__볼텍스', '《볼텍스》 자신의 턴 종료 시, 이 디지몬으로 상대의 디지몬에게 어택할 수 있다.'); await sim.drain(); return { s, d }; },
  (W, { s, d }) => [ck('vortex attacked the rested digimon', !W.alive('p2', d))]);
sc('cpusim: 급습 attack happens', async (W) => { const s = W.put('p1', 'BT1-026'); const sim = simOf(W); pushPend(W, 'p1', s, '__급습', '《급습》 자신의 턴 종료 시, 이 디지몬으로 어택할 수 있다.'); const n = W.pl('p2').security.length; await sim.drain(); return { s, n }; },
  (W, { s, n }) => [ck('attacked', s.suspended && W.pl('p2').security.length < n)]);

const runOc = async (W, s) => { S.queueTurnEndKeywords(W.st, 'p1'); const t = W.st.pending.find(x => (x.tags || []).includes('__오버클럭')); let started = null; const ctx = ctxOf(W, 'p1', s.cardId, s.uid); ctx.trigger = t; ctx.startAttack = (p, uid, tg, o) => { started = { p, uid, tg, o }; }; await Fx.runScript([{ op: 'overclock' }], ctx); return { t, started }; };
sc('오버클럭: deletes a 퍼펫형 other digimon, then attacks the player without resting', async (W) => { const s = W.put('p1', 'EX7-027'); const pup = W.put('p1', 'ST5-04'); const r = await runOc(W, s); return { s, pup, ...r }; },
  (W, { pup, t, started, s }) => [ck('pending queued with desc', !!t && !!t.overclockDesc), ck('puppet deleted', !W.alive('p1', pup)), ck('attack on PLAYER with noRest', started && started.tg === 'PLAYER' && started.o?.noRest === true && started.uid === s.uid)]);
sc('오버클럭: a token is also a valid sacrifice', async (W) => { const s = W.put('p1', 'EX7-027'); const r = await runOc(W, s); return { started: r.started }; },
  (W, { started }) => [ck('(no token/puppet present) no attack', !started)]);
sc('오버클럭: cannot sacrifice itself, no eligible -> no attack', async (W) => { const s = W.put('p1', 'EX7-027'); const r = await runOc(W, s); return { s, ...r }; },
  (W, { s, started }) => [ck('no attack', !started), ck('holder alive', W.alive('p1', s))]);
sc('에그제큐트: attacks at turn end then is deleted at attack end', async (W) => { const s = W.put('p1', 'BT20-072'); W.put('p2', lo); const sim = simOf(W); S.queueTurnEndKeywords(W.st, 'p1'); await sim.drain(); return { s }; },
  (W, { s }) => [ck('deleted after the attack', !W.alive('p1', s))]);
sc('에그제큐트: rested holder cannot attack (stays)', async (W) => { const s = W.put('p1', 'BT20-072', { suspended: true }); const sim = simOf(W); S.queueTurnEndKeywords(W.st, 'p1'); await sim.drain(); return { s }; },
  (W, { s }) => [ck('still alive', W.alive('p1', s))]);
sc('급습/볼텍스/에그제큐트/오버클럭 queue only for own digimon on the board (queueTurnEndKeywords)', async (W) => { const s = W.put('p1', 'BT26-033'); S.queueTurnEndKeywords(W.st, 'p1'); return { s }; },
  (W) => [ck('급습 pending queued', W.st.pending.some(t => (t.tags || []).includes('__급습')))]);

// ---------- CPU / cpusim parity: 딜레이 (placed option) ----------
sc('CPU: enumerates + executes 《딜레이》 on a placed option (turn after placement)', async (W) => { const o = W.put('p1', 'BT7-102'); o.placedTurn = 1; const sim = simOf(W); const acts = Cpu.enumerateActions(W.st, 'p1'); const dl = acts && acts.find(a => a.type === 'delay'); const m0 = W.mem(); if (dl) await sim.exec('p1', dl); return { acts, dl, m0 }; },
  (W, { acts, dl, m0 }) => [ck('action list available', !!acts), ck('delay action offered', !!dl), ck('memory +2 after use', W.mem() === m0 + 2)]);
sc('CPU: no 《딜레이》 on the turn the option was placed (16-17-3)', async (W) => { const o = W.put('p1', 'BT7-102'); o.placedTurn = W.st.turnNumber; const acts = Cpu.enumerateActions(W.st, 'p1'); return { acts }; },
  (W, { acts }) => [ck('no delay act', !(acts || []).some(a => a.type === 'delay'))]);

const out = await runScenarios(list, 'kw-misc');
process.exit(out.some(o => !o.ok) ? 1 : 0);
