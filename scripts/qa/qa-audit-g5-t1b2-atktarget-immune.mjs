// EX8-016 (다이너몬) official Q&A batch: while this card is suspended, opponent's Digimon may only attack suspended
// Digimon of its controller. Q3880: an opponent Digimon that is immune to this controller's effects ignores that
// restriction and may still attack a non-suspended Digimon. Also covers Q3878 ("can attack active" loses to "cannot").
// Fix: src/state.js hookAttackTargetBlocked() now lets an attacker immune to the ability owner's effects bypass
// atkTargetBlocked hooks (EX8-016 / EX11-011 share this exact mechanic).
import { S, FILL, mk, put, T, eq, ok, runAll } from './lib-s1.mjs';

function setup() {
  const st = mk();
  st.activePlayer = 'p2'; st.phase = 'main'; st.turnNumber = 5; // opponent's turn relative to p1 (EX8-016's controller)
  const dyna = put(st, 'p1', 'EX8-016', { susp: true }); // holder, must be suspended for its restriction to apply
  const other = put(st, 'p1', FILL); // a second, non-suspended Digimon of the same controller
  const atk = put(st, 'p2', FILL); // opponent's (attacking) Digimon, not suspended
  // Give the attacker a printed "can also attack active Digimon" ability (e.g. BT8-018), the actual scenario the
  // ruling addresses: without it, a non-suspended target is never legal anyway, and EX8-016's restriction is moot.
  S.grantKeyword(st, 'p2', atk.uid, '액티브공격', undefined, 'turn');
  return { st, dyna, other, atk };
}

T(3878, 'EX8-016: 레스트 상태인 동안, 액티브 상태에도 어택 가능한 상대 디지몬이라도 레스트 상태가 아닌 자신 디지몬에게는 어택 불가 (cannot > can)', async () => {
  const { st, other, atk } = setup();
  const targets = S.legalDigimonTargets(st, 'p2', atk.uid);
  ok('액티브 상태의 디지몬은 대상이 아님', !targets.includes(other.uid));
});

T(3880, 'EX8-016: 효과를 받지 않는 상대 디지몬은 레스트 상태가 아닌 디지몬에게도 어택 가능', async () => {
  const { st, other, atk } = setup();
  atk.shields = [{ kinds: ['all'] }]; // full "효과를 받지 않는다" immunity to opponent (p1) effects
  const targets = S.legalDigimonTargets(st, 'p2', atk.uid);
  ok('면역인 공격자는 액티브 상태의 디지몬도 대상으로 선택 가능', targets.includes(other.uid));
});

T('3880b', 'EX8-016: 면역이 아닌 공격자에게는 여전히 제한이 적용됨 (회귀 확인)', async () => {
  const { st, other, atk } = setup();
  const targets = S.legalDigimonTargets(st, 'p2', atk.uid);
  ok('면역이 없으면 여전히 제한됨', !targets.includes(other.uid));
});

await runAll('qa-audit-g5-t1b2-atktarget-immune');
