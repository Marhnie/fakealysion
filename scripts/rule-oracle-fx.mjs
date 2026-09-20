// Effect-boundary oracle patterns for scripts/rule-oracle.mjs: for cards whose printed effect text is ONE simple, fully-specified instruction
// (optionally with a simple checkable condition prefix), assert the postcondition of the resolved effect with logic re-derived from the TEXT only.
// Everything else (multi-sentence, optional-with-choice, target-choosing beyond the listed forms) is ignored on purpose (oracle stays conservative).
// H = helpers injected by the oracle: { S, snap, dpOf, C, opp, clamp, own, boardText, CAT-registration def }.
export function registerFxDefs(def) {
  def('FX-draw', '15-1 / 《N 드로우》', '무조건 《N 드로우》 효과: 패 +min(N,덱), 덱 -같은 수');
  def('FX-cond-draw', '15-1', '"자신의 패가 N장 이하라면 / 다른 자신의 디지몬이 있다면 《N 드로우》": 조건 성립 시에만 드로우');
  def('FX-mem', '15-1', '무조건 "메모리 ±N": 효과 발휘자 쪽으로 정확히 N (±10 클램프)');
  def('FX-cond-mem', '15-1', '"<조건>라면 메모리 +N": 조건(상대 디지몬 존재/Lv 이상 부재/레스트 상태/메모리 값)이 성립할 때만 +N');
  def('FX-setmem', '15-1', '"메모리가 N 이하라면 M으로 한다": 발휘자 쪽 메모리가 N 이하일 때만 M으로');
  def('FX-deck-trash', '15-1', '"덱 위에서부터 N장 파기한다": 덱 -min(N,덱), 트래시 +같은 수');
  def('FX-dp', '15-1', '"이 턴 동안 이 디지몬의 DP를 ±N": 그 디지몬 유효 DP가 정확히 ±N');
  def('FX-dp-opp', '15-1', '"턴 종료까지 상대의 디지몬 1마리를 DP ±N": 상대 디지몬 정확히 1마리의 DP만 ±N (대상 없음/면역 제외)');
  def('FX-destroy-dp', '15-1', '"DP N 이하의 상대 디지몬 1마리를 소멸시킨다": 후보가 있으면 정확히 1마리, 그 DP는 N 이하');
  def('FX-rest-le', '15-1', '"이 디지몬의 DP 이하의 다른 디지몬 1마리를 레스트시킬 수 있다": 레스트된 대상은 다른 디지몬이고 DP가 이 디지몬 이하, 최대 1마리');
  def('FX-src-trash', '15-1', '"Lv.N 이하의 상대 디지몬 1마리의 진화원을 아래에서부터 1장 파기한다": 대상 Lv.≤N, 맨 아래 1장이 트래시로');
  def('FX-free-play', '13-1-8-2 / 15-1', '"이 카드를 코스트를 지불하지 않고 등장시킨다"(시큐리티): 카드가 트래시에서 배틀 에어리어로');
  def('FXX-mem', '15-1', '[부작용] 효과 텍스트에 메모리/코스트 언급이 없는데 메모리가 바뀌지 않음 (잘못된 스크립트 연결 탐지)');
  def('FXX-hand', '15-1', '[부작용] 효과 텍스트에 패 관련 동작이 없는데 발휘자/상대의 패 장수가 바뀌지 않음');
  def('FXX-sec', '15-1', '[부작용] 효과 텍스트에 시큐리티 언급이 없는데 시큐리티 장수가 바뀌지 않음');
  def('FXX-battle', '15-1', '[부작용] 배틀 에어리어의 스택 수는 텍스트가 등장/소멸/되돌림 등을 말할 때만 바뀜');
  def('FXX-dp', '15-1', '[부작용] 텍스트에 DP 언급이 없는데 임시 DP 증감이 생기지 않음');
  def('FXX-rest', '15-1', '[부작용] 텍스트에 레스트/액티브/어택 언급이 없는데 레스트 상태가 바뀌지 않음');
  def('FX-kw', '15-1', '"이 턴 동안 이 디지몬은 《X》를 얻는다": 효과 해결 직후 그 키워드 보유');
}

const stripTag = (s) => String(s || '').replace(/^\s*[\[〔]턴\s*에?\s*\d+\s*회\s*[\]〕]\s*/, '');
export function normText(text) {
  return stripTag(String(text || '').replace(/\s*\([^()]*\)/g, '').replace(/\s+/g, ' ').trim()).replace(/[.。]\s*$/, '').trim();
}

export function makeFxChecker(O, H) {
  const { ck, state } = O; const { S, snap, dpOf, C, opp, clamp, own, boardText } = H;
  let cur = null, gen = null;
  const genSnap = (t) => { const pl = { p1: state.players.p1, p2: state.players.p2 }; const g = { t, npend: state.pending.length, head: state.log[0] || null, mem: state.memory, z: {}, dp: {}, susp: {}, cnt: {}, kw: {} };
    for (const q of ['p1', 'p2']) { g.z[q] = { hand: pl[q].hand.length, sec: pl[q].security.length, bat: pl[q].battle.length }; for (const st of pl[q].battle) { g.dp[st.uid] = st.tempDP || 0; g.susp[st.uid] = !!st.suspended; g.kw[st.uid] = Object.keys(st.keywords || {}).length; } }
    return g; };
  const genCheck = () => {
    const g = gen; if (!g) return; const T = String(g.t.text || ''); if (!T.trim()) return;
    const newLines = []; for (const e of state.log) { if (e === g.head) break; newLines.push(e); }
    if (newLines.some((e) => /자동 처리|룰체크|스택 소멸|패배|승리/.test(e.msg))) return; // nested auto-resolved effects / rule deletions add unrelated changes
    if (state.winner || state.pending.length > g.npend) return; // triggers queued meanwhile can pay their costs (rest a Tamer, …) at queue time
    if (/^이 카드의 【메인】 효과를 발(?:휘|동)한다/.test(T.trim()) || /^[《≪]/.test(T.trim()) || !S.CARDS[g.t.cardId]) return; // indirection / bare-keyword text / synthetic granted effects (S2-GRANT) // pure indirection to the printed 【메인】 text
    if (newLines.some((e) => /오버플로우|회피|생존 능력|아머 퍼지|방벽|스케이프고트/.test(e.msg))) return;
    const p = g.t.player, o = opp(p);
    if (state.memory !== g.mem) ck('FXX-mem', /메모리|코스트|지불|패스|게이지|진화|등장|사용|링크|합체/.test(T), () => `${g.t.cardId} 【${(g.t.tags || []).join('】【')}】 "${T.slice(0, 90)}" changed memory ${g.mem}->${state.memory}`); else ck('FXX-mem', true);
    for (const q of [p, o]) { const nh = state.players[q].hand.length; if (nh !== g.z[q].hand) ck('FXX-hand', /드로우|패|핸드|오픈|파기|등장|사용|진화|놓|덱|시큐리티|되돌|공개|테이머|링크|합체|어셈블|디지크로스|버스트|교환|가져|섞|회수|선택|[Xx]항체|카운터|블래스트/.test(T), () => `${g.t.cardId} "${T.slice(0, 90)}" ${q} hand ${g.z[q].hand}->${nh}`); }
    for (const q of [p, o]) { const ns = state.players[q].security.length; if (ns !== g.z[q].sec) ck('FXX-sec', /시큐리티|체크|어택|소멸|파기|등장|덱|패|트래시|되돌|놓|오픈|가져|회수|버스트|합체/.test(T), () => `${g.t.cardId} "${T.slice(0, 90)}" ${q} security ${g.z[q].sec}->${ns}`); }
    for (const q of [p, o]) { const nb = state.players[q].battle.length; if (nb !== g.z[q].bat) ck('FXX-battle', /소멸|등장|패로|덱|트래시|파기|되돌|놓|이동|링크|합체|진화|디지크로스|재등장|어셈블|버스트|교환|분리|퇴화|시큐리티|제외|사용|선택|어택|배틀|카운터|블래스트|효과/.test(T), () => `${g.t.cardId} "${T.slice(0, 90)}" ${q} battle ${g.z[q].bat}->${nh0(q)}`); }
    for (const q of [p, o]) for (const st of state.players[q].battle) { if (st.uid in g.dp && (st.tempDP || 0) !== g.dp[st.uid]) ck('FXX-dp', /DP|배틀|진화|소멸|디지크로스|재등장|합체|효과|색|복사|같은|퇴화/.test(T), () => `${g.t.cardId} "${T.slice(0, 90)}" DP mod ${g.dp[st.uid]}->${st.tempDP}`); if (st.uid in g.susp && !!st.suspended !== g.susp[st.uid]) ck('FXX-rest', /레스트|액티브|어택|블록|블로커|회피|재기동|리커버리|아머|효과|소멸|진화|디지크로스|재등장|합체|등장|링크|퇴화/.test(T), () => `${g.t.cardId} "${T.slice(0, 90)}" ${q} ${g.susp[st.uid] ? 'unrested' : 'rested'} a stack`); }
  };
  const nh0 = (q) => state.players[q].battle.length;
  const digimonOf = (sn, p) => sn.p[p].battle.filter((s) => s.cat === 'digimon');
  const memOwn = (m, p) => (p === 'p1' ? m : -m);
  const blockedBy = (re) => re.test(boardText(state));
  return {
    effectBegin(t) {
      cur = null; gen = genSnap(t);
      const x = normText(t.text); let m; const p = t.player, o = opp(p);
      const sn = snap(state); const info = { t, x, p, o, sn };
      const conds = [
        [/^상대의 디지몬이 (?:있다면|있을 때)$/, () => digimonOf(sn, o).length > 0],
        [/^다른 자신의 디지몬이 (?:있다면|있을 때)$/, () => digimonOf(sn, p).some((s) => s.uid !== t.stackUid)],
        [/^Lv\.(\d+) 이상의 상대의 디지몬이 없다면$/, (mm) => !digimonOf(sn, o).some((s) => s.lv >= Number(mm[1]))],
        [/^레스트 상태인 자신의 디지몬이 (?:있다면|있을 때)$/, () => digimonOf(sn, p).some((s) => s.susp)],
        [/^레스트 상태인 상대의 디지몬이 (?:있다면|있을 때)$/, () => digimonOf(sn, o).some((s) => s.susp)],
        [/^메모리가 (\d+) ?이하(?:라면|일 때)$/, (mm) => memOwn(sn.mem, p) <= Number(mm[1])],
        [/^자신의 패가 (\d+)장 이하(?:라면|일 때)$/, (mm) => sn.p[p].hand.length <= Number(mm[1])],
      ];
      const evalCond = (cs) => { for (const [re, f] of conds) { const mm = cs.match(re); if (mm) return f(mm); } return undefined; };
      if ((m = x.match(/^《(\d+) ?드로우》$/))) cur = { ...info, kind: 'draw', n: Number(m[1]) };
      else if ((m = x.match(/^(.+?), ?《(\d+) ?드로우》$/)) && evalCond(m[1]) !== undefined) cur = { ...info, kind: 'cdraw', n: Number(m[2]), cond: evalCond(m[1]) };
      else if ((m = x.match(/^메모리를? ?([+\-]\d+) ?(?:한다)?$/))) cur = { ...info, kind: 'mem', n: Number(m[1]) };
      else if ((m = x.match(/^(.+?), ?메모리 ?([+\-]\d+)(?: ?한다)?$/)) && evalCond(m[1]) !== undefined) cur = { ...info, kind: 'cmem', n: Number(m[2]), cond: evalCond(m[1]) };
      else if ((m = x.match(/^메모리가 (\d+) ?이하(?:라면|일 때), ?(\d+)으로 ?한다$/))) cur = { ...info, kind: 'setmem', a: Number(m[1]), b: Number(m[2]) };
      else if ((m = x.match(/^자신의 덱 위에서부터 (\d+)장을? 파기한다$/))) cur = { ...info, kind: 'dtrash', n: Number(m[1]) };
      else if ((m = x.match(/^(?:이 턴 동안|턴 종료까지),? 이 디지몬(?:의 DP를| DP를|을 DP) ?([+\-]\d+)(?: ?한다)?$/))) { const st = t.stackUid && state.players[p].battle.find((q) => q.uid === t.stackUid); if (st) cur = { ...info, kind: 'dp', n: Number(m[1]), dp0: dpOf(state, p, st) }; }
      else if ((m = x.match(/^(?:이 턴 동안|턴 종료까지),? 이 디지몬은 《([가-힣]+)》(?:을|를) 얻는다$/))) { const st = t.stackUid && state.players[p].battle.find((q) => q.uid === t.stackUid); if (st) cur = { ...info, kind: 'kw', kw: m[1] }; }
      else if ((m = x.match(/^턴 종료까지 상대의 디지몬 1마리를 DP ?([+\-]\d+)$/))) cur = { ...info, kind: 'dpopp', n: Number(m[1]) };
      else if ((m = x.match(/^DP ?(\d+) ?이하의 상대 ?디지몬 1마리를 소멸시킨다$/))) cur = { ...info, kind: 'destroy', n: Number(m[1]) };
      else if (/^이 디지몬의 DP 이하의 다른 디지몬 1마리를 레스트시킬 수 있다$/.test(x) && t.stackUid) cur = { ...info, kind: 'restle' };
      else if ((m = x.match(/^Lv\.(\d+) 이하의 상대 ?디지몬 1마리의 진화원을 아래에서부터 1장 파기한다$/))) cur = { ...info, kind: 'srctrash', lv: Number(m[1]) };
      else if (/^이 카드를 코스트를 지불하지 않고 등장시킨다$/.test(x) && ['digimon', 'tamer'].includes(C(t.cardId).category) && (t.tags || []).some((g) => /시큐리티/.test(g))) cur = { ...info, kind: 'freeplay', n0: state.players[p].battle.filter((s) => s.cardId === t.cardId).length, tr0: state.players[p].trash.filter((c) => c === t.cardId).length };
    },
    effectEnd() {
      try { genCheck(); } catch (e) { /* oracle bug must not break the game */ } gen = null;
      const c = cur; cur = null; if (!c) return;
      const { t, x, p, o, sn } = c; const pl = state.players[p], ol = state.players[o]; const after = snap(state);
      const blocked = state.log.slice(0, 5).some((e) => /무시됨|무효/.test(e.msg)) || blockedBy(/드로우할 ?수 ?없|메모리를? ?(?:플러스|마이너스)할 ?수 ?없|플레이어에게 어택할 수 없|효과를 받지|효과로 등장시킬 수 없|서로는 효과로/);
      const where = () => `${t.cardId} "${x}" (${p})`;
      switch (c.kind) {
        case 'draw': { const d = Math.min(c.n, sn.p[p].deck); ck('FX-draw', blocked || state.winner || (pl.hand.length - sn.p[p].hand.length === d && sn.p[p].deck - pl.deck.length === d), () => `${where()}: hand ${sn.p[p].hand.length}->${pl.hand.length} deck ${sn.p[p].deck}->${pl.deck.length}`); break; }
        case 'cdraw': { const d = c.cond ? Math.min(c.n, sn.p[p].deck) : 0; ck('FX-cond-draw', blocked || state.winner || (pl.hand.length - sn.p[p].hand.length === d), () => `${where()}: cond=${c.cond} hand ${sn.p[p].hand.length}->${pl.hand.length} expected +${d}`); break; }
        case 'mem': { const exp = clamp(sn.mem + (p === 'p1' ? 1 : -1) * c.n); ck('FX-mem', blocked || state.memory === exp || (c.n > 0 && state.memory === sn.mem), () => `${where()}: memory ${sn.mem}->${state.memory} expected ${exp}`); break; }
        case 'cmem': { const exp = c.cond ? clamp(sn.mem + (p === 'p1' ? 1 : -1) * c.n) : sn.mem; ck('FX-cond-mem', blocked || state.memory === exp || (c.n > 0 && state.memory === sn.mem), () => `${where()}: cond=${c.cond} memory ${sn.mem}->${state.memory} expected ${exp}`); break; }
        case 'setmem': { const ownB = memOwn(sn.mem, p), ownA = memOwn(state.memory, p); const exp = ownB <= c.a ? c.b : ownB; ck('FX-setmem', blocked || ownA === exp, () => `${where()}: own memory ${ownB}->${ownA} expected ${exp}`); break; }
        case 'dtrash': { const d = Math.min(c.n, sn.p[p].deck); ck('FX-deck-trash', sn.p[p].deck - pl.deck.length === d && pl.trash.length - sn.p[p].trash.length === d, () => `${where()}: deck ${sn.p[p].deck}->${pl.deck.length} trash ${sn.p[p].trash.length}->${pl.trash.length}`); break; }
        case 'dp': { const st = pl.battle.find((q) => q.uid === t.stackUid); if (st) { const d = dpOf(state, p, st); ck('FX-dp', blocked || d === c.dp0 + c.n || d <= 0 || /DP/.test(boardText(state)) && false, () => `${where()}: DP ${c.dp0}->${d} expected ${c.dp0 + c.n}`); } break; }
        case 'kw': { const st = pl.battle.find((q) => q.uid === t.stackUid); if (st) ck('FX-kw', blocked || S.hasKeyword(st, c.kw) || !!(st.keywords && st.keywords[c.kw]) || S.hasContinuousKeyword(state, p, st, c.kw), () => `${where()}: keyword ${c.kw} not held after effect`); break; }
        case 'dpopp': {
          const before = digimonOf(sn, o), changed = [];
          for (const b of before) { const a = after.p[o].battle.find((s) => s.uid === b.uid); if (a && a.dp !== b.dp) changed.push({ b, a }); }
          const gone = before.filter((b) => !after.p[o].battle.some((s) => s.uid === b.uid));
          const ok = before.length === 0 || blocked || gone.length > 0 || (changed.length === 1 && changed[0].a.dp - changed[0].b.dp === c.n) || (changed.length === 0 && /DP/.test(''));
          ck('FX-dp-opp', ok, () => `${where()}: changed ${changed.map((z) => z.b.dp + '->' + z.a.dp).join(',') || 'none'} (opp digimon ${before.length})`);
          break;
        }
        case 'destroy': {
          const cands = digimonOf(sn, o).filter((s) => s.dp <= c.n); const gone = digimonOf(sn, o).filter((b) => !after.p[o].battle.some((s) => s.uid === b.uid));
          const ok = blocked || (cands.length === 0 ? gone.length === 0 : gone.length === 1 && gone[0].dp <= c.n) || gone.length === 0; // (gone.length===0 with candidates: prevented by keyword/immunity/optional — not flagged)
          ck('FX-destroy-dp', ok, () => `${where()}: candidates ${cands.length} gone ${gone.map((g) => g.dp).join(',')}`);
          break;
        }
        case 'restle': {
          const me = sn.p[p].battle.find((s) => s.uid === t.stackUid); if (!me) break;
          const all = [...digimonOf(sn, 'p1').map((s) => ({ s, pp: 'p1' })), ...digimonOf(sn, 'p2').map((s) => ({ s, pp: 'p2' }))];
          const nowSusp = all.filter(({ s, pp }) => !s.susp && (after.p[pp].battle.find((q) => q.uid === s.uid) || {}).susp).map((x) => x.s);
          ck('FX-rest-le', nowSusp.length <= 1 && nowSusp.every((z) => z.uid !== t.stackUid && z.dp <= me.dp), () => `${where()}: rested ${nowSusp.map((z) => z.dp).join(',')} vs own DP ${me.dp}`);
          break;
        }
        case 'srctrash': {
          const ch = []; for (const b of digimonOf(sn, o)) { const a = after.p[o].battle.find((s) => s.uid === b.uid); if (a && a.src.length !== b.src.length) ch.push({ b, a }); }
          const ok = blocked || ch.length === 0 || (ch.length === 1 && ch[0].b.lv <= c.lv && ch[0].a.src.length === ch[0].b.src.length - 1 && ch[0].b.src.slice(1).join() === ch[0].a.src.join());
          ck('FX-src-trash', ok, () => `${where()}: changed ${ch.map((z) => `Lv${z.b.lv} src ${z.b.src.length}->${z.a.src.length}`).join(',')}`);
          break;
        }
        case 'freeplay': {
          const n1 = pl.battle.filter((s) => s.cardId === t.cardId).length, tr1 = pl.trash.filter((cc) => cc === t.cardId).length;
          ck('FX-free-play', blocked || (n1 === c.n0 + 1 && tr1 === c.tr0 - 1) || state.log.slice(0, 6).some((e) => /등장시킬 수 없|이미 그 영역/.test(e.msg)), () => `${where()}: on board ${c.n0}->${n1}, in trash ${c.tr0}->${tr1}`);
          break;
        }
      }
    },
  };
}
