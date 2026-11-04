// 9-5b 実機確認の修正: 速度合わせ（src/combat/speed-match.ts）・追い越しの数え方（overtake.ts）・リプレイの自動射撃の印（flags の 8）
import { describe, expect, it } from 'vitest';
import './i18n-setup';
import { createCombatInput } from '../src/combat/combat-input';
import { SpeedMatch, type SpeedMatchSubject } from '../src/combat/speed-match';
import type { CombatTarget } from '../src/combat/target';
import { AssistControl } from '../src/core/assist-control';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { SPEED_MATCH_CONFIG } from '../src/data/assist';
import { createControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { OvertakeCounter } from '../src/missions/practice/overtake';
import { applyFrame, captureFrame } from '../src/replay/sim';
import { createFrame } from '../src/replay/types';
import { arenaForce } from './ai-sim';
import { IDENTITY } from './combat-helpers';

/** 北（-Z）向きに speed で飛ぶ自機と、前方 dist m・速さ targetSpeed（北向きが正）の対象 */
function subject(speed: number, dist: number, targetSpeed: number, throttle = 1) {
  const target = {
    active: true,
    position: { x: 0, y: 0, z: -dist },
    velocity: { x: 0, y: 0, z: -targetSpeed },
    hitRadius: 6,
  } as unknown as CombatTarget & { position: Vec3; velocity: Vec3; active: boolean };
  const s: SpeedMatchSubject & {
    aircraft: { throttle: number; state: { speed: number; afterburnerActive: boolean } };
  } = {
    aircraft: {
      throttle,
      state: {
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY,
        speed,
        afterburnerActive: false,
      },
      flight: { spec: STARTER_AIRCRAFT },
    },
    combat: { targeting: { selected: target } },
    player: { active: true, velocity: { x: 0, y: 0, z: -speed } },
  };
  return { s, target };
}

describe('速度合わせ（9-5b）', () => {
  it('前方の近い対象へ速く詰めているとスロットルを下げ、離れたら元の位置へ戻す', () => {
    const m = new SpeedMatch();
    const { s, target } = subject(330, 1500, 120);
    const c = createControls();
    m.apply(c, s);
    expect(m.engaged).toBe(true);
    expect(c.throttleTarget).toBeLessThan(0.5);
    // 離れた（releaseRange の外）: 効かせ始めたときの位置（1）へ戻す
    target.position.z = -(SPEED_MATCH_CONFIG.releaseRange + 100);
    const c2 = createControls();
    m.apply(c2, s);
    expect(m.engaged).toBe(false);
    expect(c2.throttleTarget).toBe(1);
  });

  it('詰まる速さが望む速さ以下・遠い・前に無い（横 50°）なら効かない。上げることはしない', () => {
    const cases = [
      subject(200, 1500, 150), // 詰まる速さ 50
      subject(330, SPEED_MATCH_CONFIG.engageRange + 200, 100),
    ];
    for (const { s } of cases) {
      const m = new SpeedMatch();
      const c = createControls();
      m.apply(c, s);
      expect(m.engaged).toBe(false);
      expect(c.throttleTarget).toBeNull();
    }
    const side = subject(330, 1500, 0);
    side.target.position.x = 1500 * Math.sin((50 * Math.PI) / 180);
    side.target.position.z = -1500 * Math.cos((50 * Math.PI) / 180);
    const m = new SpeedMatch();
    const c = createControls();
    m.apply(c, side.s);
    expect(m.engaged).toBe(false);
    // スロットル 0.3 のまま近づいても、0.3 より上げない
    const low = subject(330, 1500, 120, 0.3);
    const m2 = new SpeedMatch();
    const c3 = createControls();
    m2.apply(c3, low.s);
    expect(c3.throttleTarget ?? 0).toBeLessThanOrEqual(0.3);
  });

  it('スロットル・AB を自分で動かしたらそちらを優先し、同じ対象には効かせない（対象が変われば効く）', () => {
    const m = new SpeedMatch();
    const { s } = subject(330, 1500, 120);
    m.apply(createControls(), s);
    expect(m.engaged).toBe(true);
    const manual = createControls();
    manual.throttleTarget = 0.9;
    m.apply(manual, s);
    expect(m.engaged).toBe(false);
    expect(manual.throttleTarget).toBe(0.9);
    const next = createControls();
    m.apply(next, s);
    expect(m.engaged).toBe(false);
    expect(next.throttleTarget).toBeNull();
    // 別の対象を選んだ
    const other = subject(330, 1500, 120);
    (s.combat.targeting as { selected: CombatTarget | null }).selected = other.target;
    const c = createControls();
    m.apply(c, s);
    expect(m.engaged).toBe(true);
    const ab = createControls();
    ab.afterburner = true;
    m.apply(ab, s);
    expect(m.engaged).toBe(false);
  });

  it('自機の速さを minSpeed より下げない（その速さで落ち着くスロットルより下げない）', () => {
    const sp = STARTER_AIRCRAFT.speed;
    const { s } = subject(SPEED_MATCH_CONFIG.minSpeed, 600, 0);
    const m = new SpeedMatch();
    const c = createControls();
    m.apply(c, s);
    const floor = (SPEED_MATCH_CONFIG.minSpeed - sp.idle) / (sp.military - sp.idle);
    expect(c.throttleTarget).toBeCloseTo(floor, 5);
  });

  it('タッチで設定が ON のときだけ。PvP は部屋の補正の「狙いの補助」が OFF なら効かない', () => {
    const s = new FlightSession({ rng: createRandom(3), enemies: arenaForce(1, 600) });
    s.reset();
    const settings = { aimAssist: 'normal' as const, autoFire: true, speedMatch: true };
    let device: 'touch' | 'keyboard' | 'gamepad' = 'touch';
    const a = new AssistControl(
      s,
      { aim: true, camera: true, hud: true },
      () => device,
      () => settings,
    );
    expect(a.speedMatchOn).toBe(true);
    a.netRules = () => ({ aimAssist: false, autoFire: true });
    expect(a.speedMatchOn).toBe(false);
    a.netRules = () => ({ aimAssist: true, autoFire: false });
    expect(a.speedMatchOn).toBe(true);
    device = 'gamepad';
    expect(a.speedMatchOn).toBe(false);
    device = 'touch';
    settings.speedMatch = false;
    expect(a.speedMatchOn).toBe(false);
  });
});

describe('追い越し・リプレイの自動射撃の印（9-5b）', () => {
  it('射程内で前にいた対象が、射程内のまま後ろへ回ったら 1 回。射程の外へ離れたら数え直す', () => {
    const o = new OvertakeCounter();
    const t = { active: true, position: { x: 0, y: 0, z: -800 } } as unknown as CombatTarget & {
      position: Vec3;
    };
    const at = (z: number, x = 0): void => {
      t.position.z = z;
      t.position.x = x;
      o.step(t, { x: 0, y: 0, z: 0 }, IDENTITY);
    };
    at(-800);
    at(-50, 10);
    at(300);
    expect(o.count).toBe(1);
    // 後ろのまま: 数えない。遠くの前（射程外）から後ろへ: 数えない
    at(400);
    at(-2000);
    at(400);
    expect(o.count).toBe(1);
  });

  it('引き金が自動射撃からなら flags の 8 を記録し、再生で戻す（判定には使わない）', () => {
    const s = new FlightSession({ rng: createRandom(3), enemies: arenaForce(1, 600) });
    s.reset();
    const input = createCombatInput();
    input.trigger = true;
    input.autoTrigger = true;
    const f = captureFrame(createFrame(), createControls(), input, s);
    expect(f.flags & 8).toBe(8);
    const back = createCombatInput();
    applyFrame(f, createControls(), back, s);
    expect(back.trigger && back.autoTrigger).toBe(true);
    input.autoTrigger = false;
    expect(captureFrame(createFrame(), createControls(), input, s).flags & 8).toBe(0);
  });
});
