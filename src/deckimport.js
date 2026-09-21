// 붙여넣기 덱 리스트 파서: "4 EX1-066", "EX1-066 x4", "4x BT7-107 아구몬", "BT7-107,4", 탭/쉼표 구분 모두 허용.
// DCGO 덱 파일("4 Minomon   BT3-004_P1")도 읽는다.
// 디지타마 카드는 디지타마 덱으로, 나머지는 메인 덱으로 자동 분류한다. 패러렐 표기(BT1-009_P1)는 기본 카드로 취급.
const ID_RE = /(?:^|[^A-Za-z0-9])([A-Za-z]{1,3}\d{0,2}-\d{1,3})(?:_[A-Za-z]\d*)?(?![A-Za-z0-9])/;

export function parseDeckText(text, S) {
  const main = {}, digitama = {};
  const errors = [], warnings = [];
  let lines = 0;
  const raw = String(text || '').replace(/\r/g, '').split('\n');
  raw.forEach((line0, i) => {
    const line = line0.replace(/[\u200b\uFEFF]/g, '').trim();
    if (!line || /^(#|\/\/|--)/.test(line) || /^(name|key card|sort index)\s*:/i.test(line)) return; // (DCGO 덱 파일 머리말 포함)
    const m = line.match(ID_RE);
    if (!m) {
      if (/\d/.test(line) && /[A-Za-z]/.test(line)) errors.push({ line: i + 1, text: line, reason: '카드 번호를 찾을 수 없음' });
      return;
    }
    lines++;
    const id = m[1].toUpperCase();
    const before = line.slice(0, m.index + (m[0].length - m[1].length - (m[0].slice(m[1].length) ? 0 : 0)));
    const after = line.slice(m.index + m[0].length);
    let n = null, mm;
    if ((mm = before.match(/^\s*(\d+)\s*[x×*]?\s+\S/i))) n = Number(mm[1]); // DCGO: "4 Minomon   BT3-004_P1" (앞 장수 + 카드 이름 + 번호)
    else if ((mm = before.match(/(\d+)\s*[x×*]?\s*$/i))) n = Number(mm[1]);
    else if ((mm = after.match(/^\s*[,;:\t ]*[x×*]?\s*(\d+)\b/i))) n = Number(mm[1]);
    else if ((mm = after.match(/[x×]\s*(\d+)\s*$/i))) n = Number(mm[1]);
    if (n == null) n = 1;
    if (!(n >= 1 && n <= 99)) { errors.push({ line: i + 1, text: line, reason: `장수가 올바르지 않음 (${n})` }); return; }
    if (!S.CARDS[id]) { errors.push({ line: i + 1, text: line, reason: `데이터에 없는 카드 번호 ${id}` }); return; }
    const zone = S.card(id).category === 'digitama' ? digitama : main;
    zone[id] = (zone[id] || 0) + n;
  });
  const cnt = (z) => Object.values(z).reduce((a, b) => a + b, 0);
  const mainN = cnt(main), digN = cnt(digitama);
  if (mainN !== 50) warnings.push(`메인 덱이 ${mainN}장입니다 (정확히 50장이어야 함)`);
  if (digN > 5) warnings.push(`디지타마 덱이 ${digN}장입니다 (최대 5장)`);
  for (const [id, n] of Object.entries({ ...main, ...digitama })) {
    const max = S.maxCopiesFor ? S.maxCopiesFor(id) : 4;
    if (n > max) warnings.push(`${S.card(id).nameKo} (${id}) ${n}장 — 최대 ${max}장`);
  }
  return { main, digitama, errors, warnings, lines, mainN, digN };
}

export function deckToText(draft, S) {
  const rows = (z) => Object.entries(z).map(([id, n]) => `${n} ${id}`);
  return [...rows(draft.main || {}), ...rows(draft.digitama || {})].join('\n');
}
