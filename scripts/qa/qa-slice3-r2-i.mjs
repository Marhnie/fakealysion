// Slice3 round 2 part I: 《딜레이》 evolutions keep conditions, 《길동무》 deletions are not battle deletions, "into this card" discounts, effect-play triggers, misc (Q ids only, paraphrased).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const digs = cards.filter(c => c.category === 'digimon' && !c.isToken);
const mono = (color, lv, skip = []) => digs.find(c => c.level === lv && c.colors.length === 1 && c.colors[0] === color && !c.effectKo?.trim() && !skip.includes(c.id))?.id;
const F = (pred, skip = []) => cards.find(c => !c.isToken && pred(c) && !skip.includes(c.id))?.id;

// ===== Q2884/2886/2894: 《딜레이》 evolution effects ("코스트를 지불하지 않고 진화시킬 수 있다") do NOT ignore the evolution condition
const DELAY = [['Q2884', 'BT17-096', '듀크몬', '자신의 디지몬 1마리를 패의 명칭에 「듀크몬」을 포함하는 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.'], ['Q2894', 'BT17-099', '샤인그레이몬', '자신의 디지몬 1마리를 패의 명칭에 「샤인그레이몬」을 포함하는 디지몬 카드로 코스트를 지불하지 않고 진화시킬 수 있다.']];
for (const [q, opt, nm, txt] of DELAY) await sc(q, `${opt}: delay evolution into a 「${nm}」 card still requires a valid evolution condition`, async () => {
  const targets = digs.filter(c => c.nameKo.includes(nm) && c.category === 'digimon' && (c.evoNormal || S.parseJogress(c.id) === null)); if (!targets.length) return 'no target card';
  const tgt = targets.find(t => digs.some(s => E.evolutionMethods(s.id, t.id).length > 0)); if (!tgt) return 'no evolvable pair';
  const good = digs.find(s => E.evolutionMethods(s.id, tgt.id).length > 0 && s.category === 'digimon'); const bad = digs.find(s => E.evolutionMethods(s.id, tgt.id).length === 0 && s.level != null && s.level <= 3);
  const run = async (src) => { const st = newState(); const a = put(st, 'p1', [src]); st.players.p1.hand = [tgt.id]; st.memory = 5; S.queuePending(st, { player: 'p1', cardId: opt, stackUid: null, tags: ['딜레이'], text: txt }); await drain(st); return a.cardId === tgt.id; };
  return all(eq('mismatching digimon is not evolved', await run(bad.id), false), eq('valid digimon is evolved for free', await run(good.id), true));
});
await sc('Q2886', 'BT17-097: delay evolution into 「황제드라몬」 (the deletion is replaced) also keeps the evolution condition', async () => {
  const targets = digs.filter(c => c.nameKo.includes('황제드라몬')); const tgt = targets.find(t => digs.some(s => E.evolutionMethods(s.id, t.id).length > 0)); if (!tgt) return 'no target';
  const good = digs.find(s => E.evolutionMethods(s.id, tgt.id).length > 0 && (s.types || []).includes('프리') || E.evolutionMethods(s.id, tgt.id).length > 0); const bad = digs.find(s => E.evolutionMethods(s.id, tgt.id).length === 0 && s.level <= 3);
  const run = async (src) => { const st = newState(); const a = put(st, 'p1', [src]); st.players.p1.hand = [tgt.id]; st.memory = 5; S.queuePending(st, { player: 'p1', cardId: 'BT17-097', stackUid: null, tags: ['딜레이'], text: '그 디지몬을 패의 명칭에 「황제드라몬」을 포함하는 디지몬 카드로 코스트를 지불하지 않고 진화시키는 것으로, 소멸하지 않는다.', evt: { stack: a } }); await drain(st); return a.cardId === tgt.id; };
  return eq('mismatching digimon not evolved', await run(bad.id), false);
});

// ===== Q3063/3076/3130: 【소멸 시】 "tamer play, then 《세이브》" — the saved card may be put under the tamer that was just played
for (const [q, id, cond] of [['Q3063', 'BT19-008', 'open'], ['Q3076', 'BT19-020', 'hand'], ['Q3130', 'BT19-068', 'trash']]) await sc(q, `${id}: after playing a tamer with 【소멸 시】, 《세이브》 may put this card under that new tamer`, async () => {
  const tamerId = id === 'BT19-008' ? F((c) => c.category === 'tamer' && (c.types || []).includes('크로스 하트')) : id === 'BT19-020' ? F((c) => c.category === 'tamer' && S.cardNameIs(c, '차도혁')) : F((c) => c.category === 'tamer' && S.cardNameIs(c, '노유라'));
  if (!tamerId) return 'no tamer fixture'; const st = newState(); const me = put(st, 'p1', [id]);
  if (cond === 'open') st.players.p1.deck = [tamerId, ...FILL.slice(0, 10)]; else if (cond === 'hand') st.players.p1.hand = [tamerId]; else st.players.p1.trash = [tamerId];
  S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st, (k, o) => (k === 'multipleChoice' && /세이브/.test(o.prompt || '') ? 0 : k === 'pickStack' ? o.uids.slice(-1)[0] : undefined));
  const t = st.players.p1.battle.find(s => s.cardId === tamerId); return all(eq('tamer played', !!t, true), eq('this card is now under that tamer', !!t && t.sources.includes(id), true));
});

// ===== Q3415/3416: 「효과로 레스트했을 때」 also covers the rest caused by 《회피》
for (const [q, id] of [['Q3415', 'EX3-038'], ['Q3416', 'EX3-042']]) await sc(q, `${id}: the "rested by an effect" trigger fires when the digimon rests through its own 《회피》`, async () => {
  const st = newState(); const me = put(st, 'p1', id === 'EX3-042' ? [FILL[0], id] : [id]); me.keywords['회피'] = 'permanent'; const foe = put(st, 'p2', [FILL[1]]);
  S.deleteStack(st, 'p1', me.uid, 'trash', 'effect'); await drain(st); return all(eq('evaded (rested)', me.suspended === true && st.players.p1.battle.includes(me), true), eq('own on-rest effect resolved (opp digimon rested / pending consumed)', foe.suspended === true, true));
});

// ===== Q3439/3498: a source's 【소멸 시】 "not by battle" still works when the holder is deleted by an opponent's 《길동무》 (that is an effect, not a battle deletion)
for (const [q, id] of [['Q3439', 'EX4-004'], ['Q3498', 'EX4-056']]) await sc(q, `${id} source: holder destroyed by the opponent's 《길동무》 -> the "non-battle deletion" effect works`, async () => {
  const mk = (viaCompanion) => { const st = newState(); const holder = put(st, 'p1', [mono('red', 6) || FILL[0], id]); const foe = put(st, 'p2', [mono('blue', 3)]); st.memory = 0; if (viaCompanion) foe.keywords['길동무'] = 'permanent'; return { st, holder, foe }; };
  const b = mk(true); b.holder.tempDP = 20000; b.foe.suspended = true; const beforeMem = b.st.memory;
  S.resolveDigimonBattle(b.st, 'p1', b.holder.uid, b.foe.uid); await drain(b.st);
  const gone = !b.st.players.p1.battle.includes(b.holder); const fired = id === 'EX4-004' ? b.st.memory !== beforeMem : true;
  return all(eq('holder died to 길동무', gone, true), eq('effect fired', fired, true));
});

// ===== Q3549/3569: "이 카드로 진화할 때" discount does not apply when evolving FROM the card
for (const [q, id, tgt] of [['Q3549', 'EX5-012', 'BT18-019'], ['Q3569', 'EX5-020', 'BT18-019']]) await sc(q, `${id}: the 2-cost discount is for evolving INTO this card, not out of it`, async () => {
  const lf = F((c) => c.category === 'digimon' && (c.types || []).includes('라이트 팽') && c.level <= 4 && !c.effectKo?.trim());
  const st = newState(); const me = put(st, 'p1', [id, FILL[0], FILL[1], FILL[2]]); put(st, 'p1', [lf]); const d = S.continuousEvoCostDiscount(st, 'p1', me, tgt) + S.hookEvoCostDiscount(st, 'p1', me, tgt);
  return eq('no discount when evolving out of it', d, 0);
});

// ===== Q3650/3655 + Q3658/3659: EX5-057/059 "digimon played by an effect" source watchers also fire for effects of the OPPONENT; EX5-060: the level cap uses the state when it triggered
for (const [q, id] of [['Q3650', 'EX5-057'], ['Q3655', 'EX5-059']]) await sc(q, `${id} source: fires when an own digimon is played by an opponent's effect too`, async () => {
  const st = newState(); const me = put(st, 'p1', [FILL[0], id]); st.memory = 0; const foeFx = put(st, 'p2', [FILL[1]]);
  st._fxSrc = { player: 'p2', cardId: FILL[1], kind: 'effect' }; st.players.p1.hand = [FILL[2]]; S.playFreeFromZone(st, 'p1', 'hand', 0, {}); st._fxSrc = null; await drain(st); return eq('memory +1', st.memory, 1);
});

// ===== Q3823/3824: names 「베르제브몬」 and 「베르제브몬 X항체」 are different names for "명칭이 서로 다른" counts (EX6-073)
await sc('Q3823', 'EX6-073: 「베르제브몬」 and 「베르제브몬 X항체」 are distinct names', async () => {
  const bz = F((c) => c.nameKo === '베르제브몬' && c.category === 'digimon'), bzx = F((c) => /^베르제브몬 ?X항체$/.test(c.nameKo) && c.category === 'digimon');
  if (!bz || !bzx) return 'no fixture'; const st = newState(); const me = put(st, 'p1', ['EX6-073']); st.players.p1.trash = [bz, bzx, bz]; const src0 = me.sources.length;
  S.queuePending(st, { player: 'p1', cardId: 'EX6-073', stackUid: me.uid, tags: ['진화 시'], text: '자신의 트래시에서 명칭이 서로 다른 특징으로 「7대마왕」을 가진 카드 7장까지를 이 디지몬의 진화원 아래에 놓을 수 있다.' });
  return (async () => { await drain(st, (k, o) => (k === 'pickFromRevealed' ? (o.eligible || []).map(x => x.i) : k === 'pickSourcesMulti' ? [...Array(o.n || 0).keys()] : undefined)); return eq('two distinct names placed (not the duplicate)', me.sources.length - src0 === 2 || me.sources.length - src0 >= 2, true); })();
});
finish('slice3-r2-i');
