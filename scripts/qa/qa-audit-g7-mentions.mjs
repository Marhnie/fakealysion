// g7 audit fix: S.cardMentions() ("「X」가 기술되어 있는" / "「X」의 기술이 있는") must also match a card whose ONLY
// reference to X is in its own printed 특징(types) list, not just name/effect text. Official general Q&A ("기재가
// 있는 카드", attached to 66 entries in EX-12/BT-26/EX-13 rulings) enumerates 특징 as one of the scanned fields.
// Concretely: EX13-037 듀나스몬's normal evolution AND assembly condition are "「윗체르니」가 기술되어 있는 Lv.5" —
// BT18-039 미스티몬 carries 윗체르니 only via types (["마법전사형","윗체르니"]), with no literal "「윗체르니」" anywhere
// in its own text. Before this fix, cardMentions (and everything built on evoTargetPredicate: canEvolveInto,
// jogress, assembly, link grants, …) silently excluded it. Run: node scripts/qa/qa-audit-g7-mentions.mjs < /dev/null
import { S, T, eq, ok, runAll } from './lib-s1.mjs';

T(1, 'cardMentions: a trait carried only in types[] (no literal 「X」 in text) still counts', () => {
  const c = S.CARDS['BT18-039'];
  ok('BT18-039 has 윗체르니 only via types', (c.types || []).includes('윗체르니'));
  ok('BT18-039 text does not literally print 「윗체르니」', !`${c.effectKo || ''}\n${c.inheritedKo || ''}`.includes('「윗체르니」') && !(c.nameKo || '').includes('윗체르니'));
  ok('cardMentions now finds it via types[]', S.cardMentions('BT18-039', '윗체르니'));
});

T(2, 'cardMentions: still matches the old ways (name / bracketed text) unchanged', () => {
  ok('name match', S.cardMentions('EX13-021', '엑자몬') || S.cardMentions('EX13-045', '엑자몬'));
  ok('bracketed-text match (EX13-037 evo line mentions 윗체르니 in its own text too)', S.cardMentions('EX13-037', '윗체르니'));
  ok('no false positive for an unrelated word', !S.cardMentions('BT18-039', '드라코몬'));
});

T(3, 'evoTargetPredicate (drives canEvolveInto/jogress/assembly): a "「X」가 기술되어 있는 Lv.N" evolution line now accepts a types-only carrier', () => {
  // EX13-037's printed evolution line: 〔진화〕 「윗체르니」가 기술되어 있는 Lv.5 : 코스트 3
  const pr = S._s4.evoTargetPredicate('「윗체르니」가 기술되어 있는 Lv.5');
  ok('predicate parsed', typeof pr === 'function');
  ok('BT18-039 (Lv.5, 윗체르니 via types only) qualifies', pr(S.CARDS['BT18-039']));
  ok('a random Lv.5 card without the trait does not qualify', !pr(S.CARDS['ST1-08']));
});
await runAll('qa-audit-g7-mentions');
