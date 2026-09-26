// w7 recheck2 (rulings idx 4002-4668) batch A: slash-OR card filters, "어택 중이라면", 자신/상대 트래시 택일. Run: node scripts/qa/qa-w7r2-a.mjs < /dev/null
import { S, E, Fx, C, newState, put, pool, dig, runEffect, runText, runAll, makeCtx, drain, faceDown } from './lib-s4.mjs';
const SC = []; const add = (q, card, fn) => SC.push({ q, card, fn });
const D3 = (i = 0) => pool(dig(3), 12)[i];
const T = (c, t) => (c.types || []).includes(t);
// picks that record what the effect offered
const rec = () => { const seen = { hand: [], zone: [], other: [] }; return { seen, picks: {
  pickFromHandIndexes: (o) => { seen.hand.push(o.eligibleIdxs || []); return (o.eligibleIdxs || []).slice(0, 1); },
  pickFromZoneIndex: (o) => { seen.zone.push(o.eligibleIdxs || []); return null; } } }; };

// BT17-077 (Q4005): 「자신/상대의 트래시」 = choose ONE trash; only that trash goes to the deck bottom
for (const pick of [0, 1]) add(4005, 'BT17-077 pick' + pick, async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT17-077', D3(0)]); put(st, 'p2', [D3(1)]); st.players.p1.trash = [D3(3), D3(4)]; st.players.p2.trash = [D3(5)];
  await runEffect(st, 'BT17-077', '등장 시', { stackUid: me.uid, picks: { multipleChoice: () => pick } });
  ck(st.players.p1.trash.length === (pick === 0 ? 0 : 2), 'p1 trash ' + st.players.p1.trash.length); ck(st.players.p2.trash.length === (pick === 1 ? 0 : 1), 'p2 trash ' + st.players.p2.trash.length);
});
// BT20-018 (Q4009/4010/4015/4018 family): "어택 중이라면" is satisfied by the OPPONENT's attack too
const chron = pool(c => c.category === 'digimon' && T(c, '크로니클') && c.level >= 4 && c.level <= 6, 3);
for (const who of ['p1', 'p2']) add(4010, 'BT20-018 attacker ' + who, async (ck) => {
  const st = newState(); const me = put(st, 'p1', ['BT20-018', D3(0)]); put(st, 'p2', [D3(1)]);
  st.players.p1.raising = S._s4.makeStack(D3(2), 1); st.players.p1.hand = [chron[0]];
  st.attackCtx = { attacker: who, opp: who === 'p1' ? 'p2' : 'p1', uid: 'x', targetKind: 'player' };
  await runEffect(st, 'BT20-018', '진화 시', { stackUid: me.uid, picks: { pickFromZoneIndex: (o) => (o.eligibleIdxs || [])[0] ?? null } });
  ck(st.players.p1.raising?.cardId === chron[0], 'raising did not evolve: ' + st.players.p1.raising?.cardId);
});


// BT9-033 / BT9-047 / BT14-009 (Q4488/4489/4492): while on the battle area (either side) no digimon may be put into the RAISING area by an effect either
const dol = Object.values(S.CARDS).find(c => c.nameKo === "도루몬" && c.category === "digimon");
for (const lock of ["BT9-033", "BT9-047", "BT14-009"]) for (const id of ["BT20-015", "BT20-053"]) for (const side of ["p1", "p2"]) add(4488, lock + " blocks " + id + " raising play (lock on " + side + ")", async (ck) => {
  const st = newState(); const me = put(st, "p1", [id, D3(0)]); put(st, "p2", [D3(1)]); put(st, side, [lock]); st.players.p1.hand = [dol.id];
  await runEffect(st, id, "등장 시", { stackUid: me.uid }); ck(!st.players.p1.raising, "raising got " + st.players.p1.raising?.cardId);
});
add(4488, "BT20-015 control (no lock)", async (ck) => { const st = newState(); const me = put(st, "p1", ["BT20-015", D3(0)]); put(st, "p2", [D3(1)]); st.players.p1.hand = [dol.id]; await runEffect(st, "BT20-015", "등장 시", { stackUid: me.uid }); ck(st.players.p1.raising?.cardId === dol.id, "no raising play"); });
// EX9-005 / EX9-055 count 「네가몬」 in trash + sources but NOT face-down sources (face-down cards carry no name)
add(4038, "EX9-055 face-down 네가몬 does not count", async (ck) => {
  const neg = Object.values(S.CARDS).find(c => c.nameKo === "네가몬" && c.category === "digitama"); if (!neg) return;
  const st = newState(); const me = put(st, "p1", ["EX9-055"]); st.players.p1.trash = [neg.id, neg.id]; faceDown(me, [neg.id, neg.id]); st.players.p1.hand = ["EX9-057"];
  await runEffect(st, "EX9-055", "등장 시", { stackUid: me.uid }); ck(!st.players.p1.raising, "face-down 네가몬 counted");
});

// BT11-088 / BT12-083 / BT11-109 (Q4490/4491, EX10-056 family): an opponent digimon may NOT be put under another opponent digimon that is unaffected by effects
const immune = (st, p, s) => S.grantShield(st, p, s.uid, { kinds: ['all'], until: 9999 });
for (const [id, tag] of [['BT11-088', '등장 시'], ['BT12-083', '진화 시']]) {
  add(4490, id + ' destination immune -> no move', async (ck) => {
    const st = newState(); const me = put(st, 'p1', [id, D3(0)]); const X = put(st, 'p2', [D3(1)]), Y = put(st, 'p2', [D3(2)]); immune(st, 'p2', Y);
    await runEffect(st, id, tag, { stackUid: me.uid }); ck(st.players.p2.battle.length === 2 && Y.sources.length === 0 && X.sources.length === 0, 'moved under an immune digimon (battle ' + st.players.p2.battle.length + ', Y src ' + Y.sources.length + ')');
  });
  add(4490, id + ' control: normal destination moves', async (ck) => {
    const st = newState(); const me = put(st, 'p1', [id, D3(0)]); const X = put(st, 'p2', [D3(1), D3(4), D3(5)]), Y = put(st, 'p2', [D3(2)]);
    await runEffect(st, id, tag, { stackUid: me.uid, picks: { pickStack: (o) => (o.uids.includes(X.uid) && !st._pk ? (st._pk = 1, X.uid) : Y.uid) } });
    ck(st.players.p2.battle.length === 1 && Y.sources.length === 1 && Y.sources[0] === D3(1), 'Y sources ' + JSON.stringify(Y.sources));
  });
}


// BT18-034 (Q4282; EX6-018 Q4285 / EX10-013 Q4324 same): evolving from the trash into 「루체몬: 폴다운 모드」 cannot ignore the evolution condition (BT7-111 has none) -> no evolution, no cost paid
{
  const lv6 = pool(c => c.category === 'digimon' && c.level === 6 && c.colors.length === 1, 1)[0];
  for (const id of ['BT18-034', 'EX6-018']) add(4282, id + ' trash 폴다운 evolution impossible', async (ck) => {
    const st = newState(); const me = put(st, 'p1', [id]); put(st, 'p1', [lv6]); st.players.p1.trash = ['BT7-111'];
    await runEffect(st, id, '자신의 턴 종료 시', { stackUid: me.uid });
    ck(S.card(me.cardId).nameKo === '루체몬', 'evolved into ' + S.card(me.cardId).nameKo);
  });
}


// BT22-024 / BT22-036 / BT23-065 / EX10-032 (Q4168/4174/4611/4374): hand 【메인】 evolution (fixed cost 3) combines with the subject's own evolve-cost discount (-1) -> pays 2
{
  const nm = (n, cat) => Object.values(S.CARDS).filter(c => c.nameKo === n && (!cat || c.category === cat)).map(c => c.id);
  for (const [id, tam, subj, under] of [['BT22-024', 'BT22-086', 'BT21-031', '쉘몬'], ['BT22-036', 'BT22-088', 'EX7-024', '슈슈몬'], ['BT23-065', 'BT23-087', 'BT21-065', '고스몬'], ['EX10-032', 'EX10-063', 'BT21-055', '랜드라몬']])
    add(4168, id + ' pays 3-1=2', async (ck) => {
      const st = newState(); put(st, 'p1', [tam]); const s = put(st, 'p1', [subj]); st.players.p1.hand = [id]; st.players.p1.trash = [nm(under, 'digimon')[0]]; st.memory = 5;
      await runEffect(st, id, '메인', { cardId: id });
      ck(S.card(s.cardId).id === id || S.card(s.cardId).nameKo === S.card(id).nameKo, 'not evolved: ' + s.cardId); ck(st.memory === 3, 'memory ' + st.memory + ' (want 3 = paid 2)');
    });
}
// BT22-090 / BT22-101 (Q4249/4266): tamer evolution from the hand still needs the target's evolution condition (security <= 3)
{
  const D = (i = 0) => pool(dig(3), 12)[i];
  for (const [sec, want] of [[5, false], [3, true]]) {
    add(4249, 'BT22-090 -> BT22-067 with security ' + sec, async (ck) => {
      const st = newState(); const me = put(st, 'p1', ['BT22-090']); put(st, 'p1', ['BT22-063']); st.players.p1.security = Array(sec).fill(D(0)); st.players.p1.hand = ['BT22-067']; st.memory = 10;
      await runEffect(st, 'BT22-090', '자신의 턴 종료 시', { stackUid: me.uid }); ck((me.cardId === 'BT22-067') === want, 'evolved=' + (me.cardId === 'BT22-067'));
    });
    add(4266, 'BT22-101 -> 알파몬 with security ' + sec, async (ck) => {
      const st = newState(); const me = put(st, 'p1', ['BT22-101']); st.players.p1.security = Array(sec).fill(D(0)); st.players.p1.hand = ['BT22-063']; st.memory = 10;
      await runEffect(st, 'BT22-101', '자신의 턴', { stackUid: me.uid }); ck((me.cardId === 'BT22-063') === want, 'evolved=' + (me.cardId === 'BT22-063'));
    });
  }
}


// EX10-013 (Q4324): 「루체몬」 5장을 덱 아래로 되돌려도(비용) 트래시의 폴다운 모드로는 진화 조건 때문에 진화할 수 없다 -> the dry check fails and nothing is paid
add(4324, 'EX10-013 trash 폴다운 evolution impossible', async (ck) => {
  const lu = Object.values(S.CARDS).filter(c => c.nameKo.includes('루체몬') && !c.nameKo.includes('폴다운')).slice(0, 5).map(c => c.id);
  const st = newState(); const me = put(st, 'p1', ['EX10-013']); st.players.p1.trash = ['BT7-111', ...lu];
  await runEffect(st, 'EX10-013', '자신의 턴 종료 시', { stackUid: me.uid });
  ck(S.card(me.cardId).nameKo === '루체몬', 'evolved into ' + S.card(me.cardId).nameKo); ck(st.players.p1.trash.length === 6, 'cost paid though evolution impossible: trash ' + st.players.p1.trash.length);
});


// BT21-021 (Q4021): the 【어택 종료 시】 play may DigiXros using this digimon itself as a material (it leaves before the self-destroy); DigiXros also lowers the paid cost (11 - 5 - 2x2 = 2)
add(4021, 'BT21-021 digicross with itself', async (ck) => {
  const nm = (n) => Object.values(S.CARDS).find(c => c.nameKo === n && c.category === 'digimon')?.id;
  const st = newState(); const me = put(st, 'p1', ['BT21-021']); put(st, 'p1', [nm('지크그레이몬')]); st.players.p1.hand = ['BT19-014']; st.memory = 10;
  await runEffect(st, 'BT21-021', '어택 종료 시', { stackUid: me.uid, picks: { multipleChoice: () => 0 } });
  const top = st.players.p1.battle.find(s => s.cardId === 'BT19-014');
  ck(!!top && top.sources.includes('BT21-021'), 'BT21-021 not used as digicross material'); ck(!st.players.p1.battle.includes(me), 'BT21-021 still on the field'); ck(st.memory === 8, 'memory ' + st.memory + ' (want 8: paid 2)');
});


// P-205 (Q4483/4665): the 《딜레이》 effect-play from the trash may declare 《어셈블리》 (7 distinct DM Lv.4 trash cards under 키메라몬) and lowers the paid cost (10 - 3 - 7 = 0)
add(4665, 'P-205 delay play with assembly', async (ck) => {
  const { runDelay } = await import('./lib-s4.mjs');
  const seen = new Set(); const dm4 = [];
  for (const c of Object.values(S.CARDS)) if (c.category === 'digimon' && c.level === 4 && (c.types || []).includes('DM') && !seen.has(c.nameKo) && c.id !== 'EX9-074') { seen.add(c.nameKo); dm4.push(c.id); }
  const st = newState(); const opt = put(st, 'p1', ['P-205']); put(st, 'p1', [dm4[0]]);
  st.players.p1.trash = ['EX9-074', ...dm4.slice(1, 9)]; st.memory = 3;
  const r = await runDelay(st, 'p1', opt.uid, { confirmEffect: () => true });
  const chim = st.players.p1.battle.find(s => s.cardId === 'EX9-074');
  ck(r.ok && !!chim, 'no 키메라몬 played'); ck(chim && chim.sources.length === 7, 'assembly sources ' + (chim && chim.sources.length)); ck(st.memory === 3, 'memory ' + st.memory + ' (cost should be 0)');
});
add(4665, 'P-205 delay play without assembly pays 7', async (ck) => {
  const { runDelay } = await import('./lib-s4.mjs');
  const seen = new Set(); const dm4 = [];
  for (const c of Object.values(S.CARDS)) if (c.category === 'digimon' && c.level === 4 && (c.types || []).includes('DM') && !seen.has(c.nameKo) && c.id !== 'EX9-074') { seen.add(c.nameKo); dm4.push(c.id); }
  const st = newState(); const opt = put(st, 'p1', ['P-205']); put(st, 'p1', [dm4[0]]);
  st.players.p1.trash = ['EX9-074', ...dm4.slice(1, 9)]; st.memory = 9;
  const r = await runDelay(st, 'p1', opt.uid, { confirmEffect: (o) => !/어셈블리/.test(o.prompt || '') });
  const chim = st.players.p1.battle.find(s => s.cardId === 'EX9-074');
  ck(!!chim && chim.sources.length === 0, 'played without assembly expected'); ck(st.memory === 2, 'memory ' + st.memory + ' (paid 7 from 9)');
});


// EX9-073 (Q4135): while 「【등장 시】 효과는 발휘하지 않는다」 (BT20-037) is active the card may still be placed on the sources, but its 【등장 시】 effect cannot be activated as this digimon's effect
add(4135, 'EX9-073 placed card 등장 시 suppressed under the BT20-037 lock', async (ck) => {
  const cand = Object.values(S.CARDS).find(c => c.category === 'digimon' && c.level === 5 && (c.types || []).includes('사이보그형') && /^【등장 시】/m.test(c.effectKo || ''));
  for (const lock of [false, true]) {
    const st = newState(); const me = put(st, 'p1', ['EX9-073', D3(0)]); put(st, 'p2', [D3(1)]); st.players.p1.hand = [cand.id]; if (lock) (st.s6NoPlayTrigAll ||= {}).p1 = 99;
    await runEffect(st, 'EX9-073', '등장 시', { stackUid: me.uid });
    ck(me.sources.includes(cand.id), 'card not placed (lock ' + lock + ')');
    ck(st.log.some(l => /등장 시】 효과는 발휘하지 않음/.test(l.msg)) === lock, 'suppression log mismatch (lock ' + lock + ')');
  }
});


// BT22-092 (Q4251-4253): 「그 디지몬의 【메인】 효과」 includes a 【메인】 effect the digimon has from an evolution source (inherited), and a [턴에 1회] 【메인】 borrowed this way cannot be activated again that turn
for (const used of [false, true]) add(4251, 'BT22-092 borrows the inherited 【메인】 (already used=' + used + ')', async (ck) => {
  const { drain } = await import('./lib-s4.mjs');
  const st = newState(); const tam = put(st, 'p1', ['BT22-092']); const dg = put(st, 'p1', ['BT22-043', D3(0)]); put(st, 'p2', [D3(1)]);
  st.players.p1.hand = ['BT22-047']; st.memory = 10; st.players.p1.deck = [D3(2), D3(3), D3(4)];
  S.digivolve(st, 'p1', dg.uid, 'BT22-047', 0, 'hand');
  if (used) (dg.turnEffectUses ||= {})['BT22-043::메인'] = 1;
  const h0 = st.players.p1.hand.length;
  await drain(st, { confirmEffect: () => true });
  ck(tam.suspended === !used, 'tamer rested=' + tam.suspended + ' (want ' + !used + ')');
  ck((st.players.p1.hand.length - h0) === (used ? 0 : 1), 'draws ' + (st.players.p1.hand.length - h0));
});


// EX9-069 (Q4123/4268): 【자신의 턴】 fires when a face-down card is put under one of your digimon (battle area) -> rest the tamer, memory +1, draw when hand <= 7; NOT for a breeding-area digimon
for (const where of ['battle', 'raising']) add(4123, 'EX9-069 face-down source under a ' + where + ' digimon', async (ck) => {
  const { drain } = await import('./lib-s4.mjs');
  const st = newState(); const tam = put(st, 'p1', ['EX9-069']); put(st, 'p2', [D3(1)]);
  const dg = S._s4.makeStack('EX9-008', 1); S.recomputeStackGrants(dg);
  if (where === 'raising') st.players.p1.raising = dg; else { dg.attackEligibleTurn = 0; st.players.p1.battle.push(dg); }
  st.players.p1.deck = [D3(2), D3(3), D3(4)]; st.players.p1.hand = [D3(5)]; st.memory = 0;
  ck(S.useTraining(st, 'p1', dg.uid), 'training failed'); await drain(st);
  const fired = where === 'battle';
  ck(tam.suspended === fired, 'tamer rested=' + tam.suspended); ck(st.memory === (fired ? 1 : 0), 'memory ' + st.memory); ck(st.players.p1.hand.length === (fired ? 2 : 1), 'hand ' + st.players.p1.hand.length);
});


// scan-manual leftovers now automated: P-179 【진화 시】 (device option -> battle area, DP +3000), EX10-054 [트래시]【메인】 (delete 묘티스몬 Lv5, pay 12-7), EX10-058 【서로의 턴】 (2 sources -> purple Lv4- from trash; Q4443)
add(4141, 'P-179 진화 시 places a 디바이스 option from hand and gets DP +3000', async (ck) => {
  const dev = Object.values(S.CARDS).find(c => c.category === 'option' && (c.types || []).includes('디바이스'));
  const st = newState(); const me = put(st, 'p1', ['P-179', D3(0)]); put(st, 'p2', [D3(1)]); st.players.p1.hand = [dev.id]; const dp0 = S.effectiveDP(st, 'p1', me);
  await runEffect(st, 'P-179', '진화 시', { stackUid: me.uid, idx: 0, picks: { confirmEffect: () => true } });
  ck(S.effectiveDP(st, 'p1', me) === dp0 + 3000, 'dp ' + S.effectiveDP(st, 'p1', me)); ck(st.players.p1.battle.some(s => s.cardId === dev.id), 'option not placed in the battle area');
});
add(4141, 'EX10-054 trash 메인: delete own 묘티스몬 Lv5, pay 5', async (ck) => {
  const st = newState(); put(st, 'p1', ['EX10-048']); st.players.p1.trash = ['EX10-054']; st.memory = 10;
  await runEffect(st, 'EX10-054', '메인', { stackUid: null, cardId: 'EX10-054', picks: { confirmEffect: () => true } });
  ck(st.players.p1.battle.length === 1 && st.players.p1.battle[0].cardId === 'EX10-054', 'EX10-054 not played'); ck(st.memory === 5, 'memory ' + st.memory);
});
add(4443, 'EX10-058 서로의 턴: opp digimon appears -> discard 2 sources, play purple Lv4- from trash', async (ck) => {
  const { drain } = await import('./lib-s4.mjs');
  const pur = pool(c => c.category === 'digimon' && c.level <= 4 && c.colors.includes('purple'), 1)[0];
  const st = newState(); const me = put(st, 'p1', ['EX10-058', D3(0), D3(2)]); st.players.p1.trash = [pur]; const oppd = put(st, 'p2', [D3(1)]);
  S.emitGameEvent(st, 'play', { owner: 'p2', stack: oppd, cause: null }); ck(st.pending.length === 1, 'not triggered');
  await drain(st, { confirmEffect: () => true, pickFromRevealed: (o) => o.eligible?.slice(0, 2).map(x => x.i) });
  ck(me.sources.length === 0 && st.players.p1.battle.some(s => s.cardId === pur), 'sources ' + me.sources.length);
});


// EX9-006 (Q4042): the face-down source discarded as the cost may itself be the card evolved into (no other Ver.5 card in the trash beforehand)
add(4042, 'EX9-006 evolves into the card it just discarded', async (ck) => {
  const v5 = pool(c => c.category === 'digimon' && (c.types || []).includes('Ver.5') && c.level === 4 && (c.types || []).includes('DM'), 1)[0];
  const st = newState(); const me = put(st, 'p1', ['EX9-007', 'EX9-006']); faceDown(me, [v5]); st.players.p1.trash = []; st.memory = 10;
  await runEffect(st, 'EX9-006', '어택 시', { stackUid: me.uid, inherited: true, picks: { confirmEffect: () => true, pickFromZoneIndex: (o) => o.eligibleIdxs?.[0] ?? null } });
  ck(me.cardId === v5, 'top is ' + me.cardId + ' (want ' + v5 + ')');
});

await runAll(SC, 'qa-w7r2-a');
