// Security-zone renderer — PRESENTATION ONLY (reads state, never mutates it).
// Security order: pl.security[0] is the TOP (checked first; shift() in state.js). Hidden cards are never revealed:
// only face-up (pl.secUp) cards and the card that is being checked right now (public the moment it is checked) are shown.
// Animations are keyed by state changes via bookkeeping kept OUTSIDE the DOM (render() rebuilds everything).
const MAX_BACKS = 10;
const prev = {};          // p -> { count, trash, at }
const anim = {};          // p -> { kind:'lift'|'out'|'in', n, at, dur, id }
const seenAt = new Map(); // key -> first-seen ms
const ui = { open: null };
export const secToggle = (p) => { ui.open = ui.open === p ? null : p; };
export const secOpenOf = () => ui.open;
const first = (key) => { if (!seenAt.has(key)) { seenAt.set(key, Date.now()); if (seenAt.size > 200) seenAt.delete(seenAt.keys().next().value); } return Date.now() - seenAt.get(key); };
const delayStyle = (ms) => `animation-delay:${-Math.max(0, ms)}ms`;

export const SECURITY_HELP = '시큐리티: 배틀에서 상대가 어택했을 때 위에서부터 체크되는 카드. 0장이 된 뒤 어택이 성공하면 패배';

// Call once per render per player BEFORE building the zone: notes count changes so the right animation plays.
function track(p, pl, S, checking, state) {
  const cnt = pl.security.length, trash = pl.trash.length, now = Date.now();
  const pv = prev[p];
  if (pv && pv.st === state && pv.count !== cnt) {
    const d = cnt - pv.count;
    if (d < 0) anim[p] = { kind: checking ? 'lift' : (trash > pv.trash ? 'out' : 'hand'), n: -d, at: now, dur: checking ? 1100 : 900, id: pl.trash[pl.trash.length - 1] };
    else anim[p] = { kind: 'in', n: d, at: now, dur: 1000 };
  }
  prev[p] = { count: cnt, trash, st: state };
  const a = anim[p];
  return a && now - a.at < a.dur ? a : null;
}

export function resetSecurityUi() { for (const k of Object.keys(prev)) delete prev[k]; for (const k of Object.keys(anim)) delete anim[k]; seenAt.clear(); ui.open = null; }

// opts: { h, S, state, p, pa, mode ('full'|'normal'|'off'), cardChip, onChange }
export function renderSecurityZone(o) {
  const { h, S, state, p, pa, cardChip, onChange } = o;
  const pl = state.players[p];
  const cnt = pl.security.length;
  const isTarget = !!(pa && pa.targetKind === 'player' && pa.opp === p);
  const ctl = isTarget ? pa.secCtl : null;
  const inCheck = !!(isTarget && pa.stage === 'result');
  const a = track(p, pl, S, inCheck, state);
  const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const st = o.mode === 'off' || reduced ? ' sec-static' : (o.mode === 'normal' ? ' sec-fxn' : '');

  // ---- face-up positions (multiset secUp mapped onto the first copies from the top) ----
  const left = { ...(pl.secUp || {}) };
  const cells = pl.security.map((id) => { const up = (left[id] || 0) > 0; if (up) left[id]--; return { id, up }; });
  const upTotal = cells.filter(c => c.up).length;

  // ---- attack context ----
  let checksTotal = 0, bonus = 0, jamming = false, atkName = '';
  if (isTarget) {
    const aSt = state.players[pa.attacker].battle.find(s => s.uid === pa.uid) || (state.players[pa.attacker].raising?.uid === pa.uid ? state.players[pa.attacker].raising : null);
    if (aSt) { bonus = S.hookSecurityAttackBonus(state, pa.attacker, aSt); jamming = S.hasKeyword(aSt, '재밍'); atkName = S.card(aSt.cardId).nameKo; }
    checksTotal = ctl ? ctl.total : 1 + bonus;
  }
  const danger = cnt <= 1 && !state.winner ? (cnt === 0 ? ' sec-last' : ' sec-danger') : '';
  const cls = `sec-zone pile-security sec-${p}${st}${danger}${isTarget && !inCheck ? ' sec-target' : ''}${inCheck ? ' sec-checking' : ''}${cnt === 0 ? ' sec-empty' : ''}${ui.open === p ? ' sec-open' : ''}`;

  // ---- stack of card backs / face-up cards ----
  const shown = cells.slice(0, MAX_BACKS);
  const fan = shown.map((c, i) => {
    const cd = c.up ? S.card(c.id) : null;
    const el = h('div', { className: `sec-card${c.up ? ' sec-up' : ' sec-back'}${i === 0 ? ' sec-top' : ''}${a && a.kind === 'in' && i < a.n ? ' sec-new' : ''}`, style: `--i:${i};z-index:${MAX_BACKS - i}${a && a.kind === 'in' && i < a.n ? ';' + delayStyle(Date.now() - a.at) : ''}`, title: c.up ? `앞면 시큐리티: ${cd.nameKo} (공개 정보)` : (i === 0 ? '맨 위 카드 (가장 먼저 체크됨)' : '뒷면 카드 (비공개)') },
      c.up ? [cd.imgUrl ? h('img', { src: o.artUrl ? o.artUrl(c.id) : cd.imgUrl, alt: cd.nameKo, loading: 'lazy' }) : h('span', {}, cd.nameKo)] : []);
    return el;
  });
  const stack = h('div', { className: 'sec-stack', style: `--n:${Math.max(1, fan.length)}` }, fan.length ? fan : [h('div', { className: 'sec-none' }, '0')]);
  if (cnt > MAX_BACKS) stack.appendChild(h('span', { className: 'sec-more' }, `+${cnt - MAX_BACKS}`));
  if (a && (a.kind === 'lift' || a.kind === 'out' || a.kind === 'hand')) {
    stack.appendChild(h('div', { className: `sec-ghost sec-ghost-${a.kind}`, style: `${delayStyle(Date.now() - a.at)}` }, a.kind === 'hand' ? '✋' : ''));
  }
  if (a && a.kind === 'in') stack.appendChild(h('div', { className: 'sec-fly', style: delayStyle(Date.now() - a.at) }, `+${a.n}`));
  if (a && a.kind !== 'in') stack.appendChild(h('div', { className: 'sec-fly sec-fly-minus', style: delayStyle(Date.now() - a.at) }, `−${a.n}`));

  const head = h('div', { className: 'sec-head' }, [
    h('span', { className: 'sec-label' }, '🛡 시큐리티'),
    h('b', { className: `sec-num${a && a.kind !== 'in' ? ' sec-tickdown' : a ? ' sec-tickup' : ''}`, style: a ? delayStyle(Date.now() - a.at) : '' }, String(cnt)),
  ]);
  const tags = [];
  if (cnt > 0) tags.push(h('span', { className: 'sec-toptag', title: '맨 위 카드: 다음에 가장 먼저 체크됩니다' }, '▲TOP'));
  if (upTotal) tags.push(h('span', { className: 'sec-vis', title: '앞면(공개) 시큐리티 카드 수' }, `👁 ${upTotal}`));
  if (cnt === 0) tags.push(h('span', { className: 'sec-lastbadge' }, 'LAST'));
  else if (cnt === 1) tags.push(h('span', { className: 'sec-lastbadge sec-warn' }, '마지막 1장'));

  // ---- status / attack line ----
  const status = [];
  if (isTarget) {
    if (!inCheck) {
      const lethal = cnt === 0;
      status.push(h('div', { className: `sec-msg${lethal ? ' sec-msg-lethal' : ''}` }, lethal ? '시큐리티 0 — 직접 어택 성공 시 패배!' : `🎯 ${checksTotal}장 체크 예정${bonus ? ` (S어택 ${bonus > 0 ? '+' : ''}${bonus})` : ''}${jamming ? ' · 🚫재밍' : ''}`));
    } else if (ctl) {
      const dots = [];
      for (let i = 0; i < Math.max(ctl.total, 1); i++) dots.push(h('i', { className: `sec-dot${i < ctl.results.filter(r => !r.empty).length ? ' done' : (i === ctl.results.length ? ' cur' : '')}` }));
      status.push(h('div', { className: 'sec-progress', title: '체크 진행' }, [...dots, h('span', {}, `${Math.min(ctl.results.filter(r => !r.empty).length + (ctl.awaiting ? 1 : 0), ctl.total)}/${ctl.total} 체크`)]));
      if (pa.res && pa.res.gameOver) status.push(h('div', { className: 'sec-msg sec-msg-lethal' }, '시큐리티 0 — 직접 어택 성공!'));
    }
  } else if (cnt === 0 && !state.winner) status.push(h('div', { className: 'sec-msg sec-msg-lethal' }, '다음 어택이 성공하면 패배'));
  else if (cnt === 1 && !state.winner) status.push(h('div', { className: 'sec-msg sec-msg-warn' }, '마지막 시큐리티! 다음 어택이 성공하면 승리'));

  // ---- reveal of the card being checked (public: it is being turned face-up right now) ----
  let reveal = null;
  if (inCheck && ctl) {
    const aw = ctl.awaiting, lastR = ctl.results[ctl.results.length - 1];
    const idx = aw ? ctl.i : ctl.results.length - 1;
    const rid = aw ? aw.id : (lastR && !lastR.empty ? lastR.revealed : null);
    if (rid) {
      const c = S.card(rid);
      const txt = `${c.effectKo || ''}\n${c.inheritedKo || ''}`;
      const hasSec = /【시큐리티】/.test(txt);
      const isDig = c.category === 'digimon';
      const phase = aw ? 'reveal' : 'result';
      const r = aw ? null : lastR;
      const secDp = r ? r.secDp : c.dp || 0;
      const atkDp = r ? r.atkDp : pa.dp;
      let verdict = null, vcls = '';
      if (r) {
        if (r.result === 'attackerWins') { verdict = 'WIN — 시큐리티 파기'; vcls = 'win'; }
        else if (r.result === 'defenderWins') { verdict = 'LOSE — 공격측 소멸'; vcls = 'lose'; }
        else if (r.result === 'tie') { verdict = 'TIE — 양쪽 소멸'; vcls = 'lose'; }
        else if (r.result === 'jammedSurvive') { verdict = '≪재밍≫ 생존'; vcls = 'win'; }
        else verdict = '배틀 없음';
      }
      const key = `${pa.uid}:${idx}:${phase}`;
      const el = first(key);
      reveal = h('div', { className: `sec-reveal sec-rv-${phase}${vcls ? ' sec-' + vcls : ''}`, style: delayStyle(el) }, [
        h('div', { className: 'sec-rv-title' }, `체크 ${idx + 1}/${ctl.total} — ${aw ? '공개!' : '결과'}`),
        h('div', { className: 'sec-rv-cardwrap', style: delayStyle(el) }, [cardChip(rid, { owner: p })]),
        h('div', { className: 'sec-rv-meta' }, [c.nameKo, isDig ? ` · DP ${secDp}` : ` · ${c.category === 'option' ? '옵션' : c.category === 'tamer' ? '테이머' : c.category}`]),
        hasSec ? h('span', { className: 'sec-rv-badge' }, '🛡 【시큐리티】 발동!') : null,
        isDig && r && r.result !== 'noBattle' ? h('div', { className: 'sec-rv-vs' }, `DP ${atkDp} vs ${secDp}`) : null,
        verdict ? h('div', { className: `sec-verdict ${vcls}`, style: delayStyle(el) }, verdict) : (isDig ? h('div', { className: 'sec-rv-vs' }, aw ? '【시큐리티】 효과 처리 후 배틀' : '') : null),
      ]);
    }
  }

  // ---- info popover ----
  let pop = null;
  if (ui.open === p) {
    const ups = cells.filter(c => c.up);
    pop = h('div', { className: 'sec-pop', onClick: (e) => e.stopPropagation() }, [
      h('div', { className: 'sec-pop-t' }, `${p.toUpperCase()} 시큐리티: ${cnt}장`),
      h('div', { className: 'sec-pop-help' }, SECURITY_HELP),
      h('div', {}, ups.length ? ['앞면(공개) 카드: ', ...ups.map((c, i) => h('div', { className: 'sec-pop-up' }, `${i + 1}. ${S.card(c.id).nameKo}${S.card(c.id).dp ? ` (DP ${S.card(c.id).dp})` : ''}`))] : '앞면 카드 없음 — 나머지는 모두 비공개'),
      isTarget ? h('div', {}, `이번 어택: 체크 ${ctl ? ctl.results.filter(r => !r.empty).length : 0}/${checksTotal}회 진행`) : null,
      h('button', { className: 'sec-pop-x', onClick: (e) => { e.stopPropagation(); ui.open = null; onChange && onChange(); } }, '닫기'),
    ]);
  }

  const zone = h('div', {
    className: cls, 'data-pile': 'security', 'data-count': String(cnt), role: 'button', tabindex: '0',
    title: `${SECURITY_HELP}\n(탭하면 정보)`,
    onClick: () => { secToggle(p); onChange && onChange(); },
  }, [head, stack, h('div', { className: 'sec-tags' }, tags), ...status, reveal, pop]);
  return zone;
}
