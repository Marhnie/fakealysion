// Slice3 round 2 part G: repeated-ruling families (deck-discard vs opened cards, optional openings, 「용」 substring, S attack -1 on own digimon, end-attack costs, cost-reduced option use).
import { S, E, Fx, C, newState, put, other, drain, playCard, trig, sc, finish, eq, all, FILL } from './s3lib.mjs';
const cards = Object.values(S.CARDS);
const F = (pred, skip = []) => cards.find(c => !c.isToken && pred(c) && !skip.includes(c.id))?.id;
const mono = (color, lv, skip = []) => cards.find(c => c.category === 'digimon' && c.level === lv && c.colors.length === 1 && c.colors[0] === color && !c.effectKo?.trim() && !skip.includes(c.id))?.id;

// ===== Q3333/3340/3361/3368: 「이 카드가 덱에서 파기되었을 때」 fires only for a direct deck discard, not when the card was opened/looked at first
for (const [q, id] of [['Q3333', 'EX2-039'], ['Q3340', 'EX2-044'], ['Q3361', 'EX2-071'], ['Q3368', 'EX2-074']]) await sc(q, `${id}: "discarded from deck" effect only on a direct deck discard (not opened-then-discarded)`, async () => {
  const run = async (viaOpen) => {
    const st = newState(); const me = put(st, 'p1', [FILL[0]]); put(st, 'p2', [FILL[1]]); put(st, 'p2', [mono('red', 4)]); put(st, 'p1', [FILL[2]]); st.memory = 0;
    st.players.p1.deck = [id, FILL[3], FILL[4], FILL[5], FILL[6]]; st.players.p1.trash = id === 'EX2-044' ? [C('EX2-039') ? 'EX2-039' : FILL[7]] : [];
    if (viaOpen) S.queuePending(st, { player: 'p1', cardId: FILL[0], stackUid: me.uid, tags: ['등장 시'], text: '자신의 덱 위에서부터 3장 오픈한다. 그중 특징으로 「없는특징」을 가진 카드 1장을 패에 추가한다. 나머지는 파기한다.' });
    else S.queuePending(st, { player: 'p1', cardId: FILL[0], stackUid: me.uid, tags: ['등장 시'], text: '자신의 덱 위에서부터 3장 파기한다.' });
    await drain(st); return [st.memory, st.players.p2.battle.length, st.players.p1.battle.length, st.players.p1.trash.length];
  };
  const direct = await run(false), opened = await run(true);
  const changed = (r) => r[0] !== 0 || r[1] !== 2 || r[2] !== 2 || r[3] > (id === 'EX2-044' ? 4 : 3);
  return all(eq('direct: card effect fired (some observable change)', changed(direct), true), eq('opened-then-discarded: nothing fired', changed(opened), false));
});

// ===== Q3233/3234/3235/3245: EX1-048/049/050 (open) and EX1-060 (discard) — the 【진화 시】 can be declined; once opened, the rest must be done
for (const [q, id] of [['Q3233', 'EX1-048'], ['Q3234', 'EX1-049'], ['Q3235', 'EX1-050'], ['Q3245', 'EX1-060']]) await sc(q, `${id}: the optional 【진화 시】 can be declined (nothing opened / discarded)`, async () => {
  const st = newState(); const me = put(st, 'p1', [id]); st.players.p1.hand = [FILL[9]]; st.players.p1.deck = FILL.slice(0, 10); const d0 = st.players.p1.deck.length, h0 = st.players.p1.hand.length, t0 = st.players.p1.trash.length;
  await trig(st, 'p1', me, 'digivolve', (k) => (k === 'confirmEffect' ? false : (k === 'pickFromHandIndexes' || k === 'pickFromZoneIndex' || k === 'pickFromRevealed' ? (k === 'pickFromHandIndexes' || k === 'pickFromRevealed' ? [] : null) : undefined)));
  return all(eq('deck untouched', st.players.p1.deck.length, d0), eq('hand untouched', st.players.p1.hand.length, h0), eq('trash untouched', st.players.p1.trash.length, t0));
});

// ===== Q3370/3371/3376/3377: 특징에 「용」/「룡」을 "포함하는" is a substring test (용인형 / 화염룡형 ... all count)
const dragonHum = F((c) => c.category === 'digimon' && (c.types || []).some(t => t === '용인형') && !c.effectKo?.trim());
await sc('Q3370', 'EX3-003 on attack: a 용인형 digimon among the opened cards is eligible (substring of 용)', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX3-003']); st.players.p1.deck = [FILL[0], dragonHum, FILL[1], ...FILL.slice(2, 8)]; st.players.p1.hand = []; await trig(st, 'p1', me, 'attack'); return eq('hand', st.players.p1.hand.join(), dragonHum);
});
for (const [q, id] of [['Q3371', 'EX3-006'], ['Q3376', 'EX3-009']]) await sc(q, `${id} source: the on-attack draw works for a holder whose trait merely contains 용/룡 (용인형)`, async () => {
  const st = newState(); const me = put(st, 'p1', [dragonHum, id]); const d0 = st.players.p1.deck.length; await trig(st, 'p1', me, 'attack'); return eq('drew', d0 - st.players.p1.deck.length, 1);
});
await sc('Q3377', 'EX3-014 on play: each source with a 용/룡-containing trait (용인형) raises the DP cap by 2000', async () => {
  const st = newState(); const me = put(st, 'p1', ['EX3-014', dragonHum, dragonHum]); const foe = put(st, 'p2', [mono('blue', 4)]); st.players.p2.battle[0].tempDP = 0; foe.cardId = foe.cardId; const dp = S.effectiveDP(st, 'p2', foe);
  // cap = 3000 + 2*2000 = 7000: adjust the foe to DP<=7000 and >3000
  foe.tempDP = 6000 - dp; await trig(st, 'p1', me, 'play'); return eq('foe deleted (cap 7000 reached)', st.players.p2.battle.length, 0);
});

// ===== Q3722/3728/3734/3740: EX6-023..026 【등장 시】【어택 시】 may hand 《S 어택 -1》 to ONE OF OUR OWN digimon as well
for (const [q, id] of [['Q3722', 'EX6-023'], ['Q3728', 'EX6-024'], ['Q3734', 'EX6-025'], ['Q3740', 'EX6-026']]) await sc(q, `${id}: 《S 어택 -1》 can be given to an own digimon`, async () => {
  const st = newState(); const me = put(st, 'p1', [id]); const mine = put(st, 'p1', [FILL[1]]); put(st, 'p2', [FILL[2]]);
  await trig(st, 'p1', me, 'play', (k, o) => (k === 'pickStackAnySide' ? { player: 'p1', uid: mine.uid } : undefined));
  return eq('own digimon has S attack -1', S.securityAttackBonus(mine), -1);
});

// ===== Q3772/3774 family: 「~소멸시키는 것으로, 그 어택을 종료한다」 (EX6-045/048, EX7-052/054 source, a defender-side reaction): no deletion -> the attack is not ended; an effect-immune attacker's attack can still be ended
for (const [q, qb, id] of [['Q3772', 'Q3774', 'EX6-045'], ['Q3782', 'Q3784', 'EX6-048'], ['Q3858', 'Q3860', 'EX7-052'], ['Q3861', 'Q3863', 'EX7-054']]) {
  const setup = () => { const st = newState(); const me = put(st, 'p1', [FILL[0], id]); const buddy = put(st, 'p1', [FILL[1]]); const atk = put(st, 'p2', [FILL[2]]); st.activePlayer = 'p2'; st.turnNumber++; return { st, me, buddy, atk }; };
  const react = async (env) => { const opts = S.hookRedirectOptions(env.st, 'p1', 'p2', env.atk).filter(o => o.endsAttack); if (!opts.length) return null; return opts[0].pay(async (k) => (k === 'pickStack' ? env.buddy.uid : null)); };
  await sc(q, id + ' source: if the chosen own digimon could not be deleted the attack is not ended', async () => {
    const env = setup(); env.buddy.s1 = { noEffectDelete: env.st.turnNumber + 1 }; const r = await react(env); return all(eq('buddy alive', env.st.players.p1.battle.includes(env.buddy), true), eq('reaction did not end the attack', r, false));
  });
  await sc(qb, id + " source: an effect-immune attacker's attack can still be ended (a timing change, not an effect on it)", async () => {
    const env = setup(); env.atk.s1 = { immune: env.st.turnNumber + 1 }; const r = await react(env); return all(eq('buddy deleted', env.st.players.p1.battle.includes(env.buddy), false), eq('reaction ends the attack', r, true));
  });
}

// ===== Q3271/3307/3312/3316/3319: an option whose OWN hand cost was lowered to 1 or less is not a "cost 2+" option use (BT8-097: cost 6 minus 1 per opp digimon)
for (const [q, holder] of [['Q3271', 'EX2-003'], ['Q3307', 'EX2-019'], ['Q3312', 'EX2-021'], ['Q3316', 'EX2-023'], ['Q3319', 'EX2-024']]) await sc(q, holder + ': using BT8-097 whose cost was lowered to 1 by its own text does not trigger the "cost 2+ option" effect (a cost-3+ use does)', async () => {
  const big = mono('red', 5) || mono('red', 4);
  const run = async (foes) => {
    const st = newState(); const me = put(st, 'p1', [FILL[0], holder]); if (holder === 'EX2-024') { me.cardId = holder; me.sources = [FILL[0]]; }
    put(st, 'p1', [mono('red', 3)]); const tg = put(st, 'p2', [big]); for (let i = 1; i < foes; i++) put(st, 'p2', [big]);
    st.players.p1.deck = FILL.slice(0, 10); st.memory = 10; st.players.p1.hand = ['BT8-097']; const dp0 = foes ? st.players.p2.battle.map(x => S.effectiveDP(st, 'p2', x)) : [];
    S.useOptionCard(st, 'p1', 0); await drain(st);
    return { hand: st.players.p1.hand.length, mem: st.memory, dpLoss: st.players.p2.battle.some((x, k) => S.effectiveDP(st, 'p2', x) < dp0[k]) };
  };
  const cheap = await run(5), dear = await run(2);
  const fired = (r) => r.hand > 0 || r.mem > 10 - 6 + 0 && false || r.dpLoss;
  const cheapFired = cheap.hand > 0 || cheap.dpLoss || cheap.mem !== 9;
  const dearFired = dear.hand > 0 || dear.dpLoss || dear.mem !== 6;
  return all(eq('cost<=1 use: nothing extra (paid exactly 1)', cheapFired, false), eq('control: cost 4 use triggers the watcher', dearFired, true));
});
finish('slice3-r2-g');
