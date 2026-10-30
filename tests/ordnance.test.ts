// 無誘導兵器（2-6）: ロケットと爆弾の弾道・ダメージ、爆弾の着弾予測点（地形の高さと一致・実際の着弾と一致）、
// タッチ・パッドの長押し（兵装の切替・爆弾の投下）とキー・パッドの割当
import { describe, expect, it } from 'vitest';
import { BombBay, predictImpact } from '../src/combat/bomb';
import { createCombatInput } from '../src/combat/combat-system';
import type { Shooter } from '../src/combat/gun';
import type { Impact } from '../src/combat/projectile';
import { RocketPod } from '../src/combat/rocket';
import { TEAM_PLAYER } from '../src/combat/target';
import { actionIndex, createActionValues, mapGamepad } from '../src/core/gamepad';
import { WeaponInput, type ActionReader } from '../src/core/weapon-input';
import { DEFAULT_GAMEPAD_MAPPING } from '../src/data/gamepad';
import { DEFAULT_KEYBINDS, type Action } from '../src/data/keybinds';
import { BOMB_CONFIG, ROCKET_CONFIG } from '../src/data/ordnance';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { quatIdentity, vec3, type Quat } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { getGroundHeight, getHeight } from '../src/render/terrain-height';

const DT = 1 / 60;
const NO_SPREAD = (): number => 0.5;

function shooter(
  x: number,
  y: number,
  z: number,
  speed: number,
  q: Quat = quatIdentity(),
): Shooter {
  return { position: { x, y, z }, orientation: q, speed };
}

describe('ロケット', () => {
  it('左右から 2 発同時、350 m/s + 機速で機首方向へ。12 発 = 6 斉射、斉射の間隔 0.3 秒', () => {
    const pod = new RocketPod(undefined, null, NO_SPREAD);
    const s = shooter(0, 1000, 0, 250);
    expect(pod.tryFire(s)).toBe(true);
    expect(pod.rockets.count).toBe(2);
    expect(pod.count).toBe(10);
    const [a, b] = [pod.rockets.get(0), pod.rockets.get(1)];
    expect(a.x).toBeCloseTo(-ROCKET_CONFIG.launchOffset.x, 9);
    expect(b.x).toBeCloseTo(ROCKET_CONFIG.launchOffset.x, 9);
    expect(a.vz).toBeCloseTo(-(250 + 350), 9);
    // 間隔の間は撃てない
    expect(pod.tryFire(s)).toBe(false);
    let salvos = 1;
    for (let i = 0; i < 60 * 5; i++) {
      pod.step([], () => true, DT);
      if (pod.tryFire(s)) salvos++;
    }
    expect(salvos).toBe(6);
    expect(pod.count).toBe(0);
  });

  it('弾道は重力で落ちる放物線: t 秒後に 600t 進み、g t² / 2 落ちる', () => {
    const pod = new RocketPod(undefined, null, NO_SPREAD);
    pod.tryFire(shooter(0, 1000, 0, 250));
    const r = pod.rockets.get(0);
    const y0 = r.y;
    for (let i = 0; i < 120; i++) pod.step([], () => true, DT);
    const t = 2;
    expect(r.z).toBeCloseTo(-600 * t + ROCKET_CONFIG.launchOffset.z, 6);
    expect(y0 - r.y).toBeCloseTo(0.5 * 9.8 * t * t, 6);
    expect(r.vy).toBeCloseTo(-9.8 * t, 9);
  });

  it('当たると 1 発 60（表面から 5m 以内）。プレイヤー側には入らない。寿命 6 秒で消える', () => {
    const s = new FlightSession({ rng: NO_SPREAD });
    s.startMission({ x: 0, y: 1000, z: 0, headingDeg: 0 });
    s.spawn({
      kind: 'groundTarget',
      group: 'g',
      targetType: 'hangar',
      trigger: { type: 'start' },
      positions: [{ x: 0, z: -1000 }],
    });
    const hangar = s.props.groundTargets[0];
    if (!hangar) throw new Error('地上目標がない');
    // 機首を格納庫の中心へ向ける（水平から下へ）
    const p = s.aircraft.state.position;
    const dir = { x: 0, y: hangar.position.y - p.y, z: -1000 - p.z };
    const pitch = Math.atan2(dir.y, -dir.z);
    s.aircraft.state.orientation.x = Math.sin(pitch / 2);
    s.aircraft.state.orientation.w = Math.cos(pitch / 2);
    const fire = { ...createCombatInput(), rocket: true };
    const none = createCombatInput();
    s.combat.step(fire, s.aircraft.state, DT);
    for (let i = 0; i < 4 * 60; i++) s.combat.step(none, s.aircraft.state, DT);
    expect(s.combat.rockets.rockets.count).toBe(0);
    expect(hangar.maxHp - hangar.hp).toBe(120);
    // 自機にはロケットの爆風が入らない
    expect(s.player.hp).toBe(s.player.maxHp);
    // 当たらないロケットは寿命で消える
    const pod = new RocketPod(undefined, null, NO_SPREAD);
    pod.tryFire(shooter(0, 5000, 0, 0, headingQuat(quatIdentity(), 0)));
    for (let i = 0; i < ROCKET_CONFIG.life * 60 + 2; i++) pod.step([], () => true, DT);
    expect(pod.rockets.count).toBe(0);
  });
});

/** 島の陸の上で、北へ水平に飛ぶ自機 */
function landShooter(): Shooter {
  return shooter(-200, 900, 1200, 250, headingQuat(quatIdentity(), 0));
}

describe('爆弾と着弾予測点', () => {
  it('機速のまま放物線で落ちる（投下から t 秒後に 250t 進み g t² / 2 落ちる）', () => {
    const bay = new BombBay(undefined, () => -1e9);
    const s = shooter(0, 3000, 0, 250);
    expect(bay.tryDrop(s)).toBe(true);
    const b = bay.bombs.get(0);
    for (let i = 0; i < 180; i++) bay.step(null, [], () => true, DT);
    const t = 3;
    expect(b.z).toBeCloseTo(-250 * t, 6);
    expect(b.y).toBeCloseTo(3000 + BOMB_CONFIG.releaseOffset.y - 0.5 * 9.8 * t * t, 6);
    expect(bay.count).toBe(3);
  });

  it('着弾予測点は放物線と地形の交点で、高さは getHeight と一致する', () => {
    const out = vec3();
    const s = landShooter();
    const o = { x: s.position.x, y: s.position.y + BOMB_CONFIG.releaseOffset.y, z: s.position.z };
    const v = { x: 0, y: 0, z: -250 };
    const t = predictImpact(out, o, v, 9.8, getGroundHeight);
    expect(t).toBeGreaterThan(5);
    // 陸の上（海面ではない）
    expect(getHeight(out.x, out.z)).toBeGreaterThan(5);
    expect(out.y).toBeCloseTo(getHeight(out.x, out.z), 9);
    // 放物線の t 秒後の高さとも 1cm 以内
    expect(Math.abs(o.y - 0.5 * 9.8 * t * t - out.y)).toBeLessThan(0.01);
    expect(out.z).toBeCloseTo(o.z - 250 * t, 6);
  });

  it('高すぎる（落ちるのに 15 秒より長い）なら予測点を出さない', () => {
    const out = vec3();
    expect(predictImpact(out, { x: 0, y: 3000, z: 0 }, { x: 0, y: 0, z: -250 }, 9.8, () => 0)).toBe(
      -1,
    );
  });

  it('実際の着弾は、投下した瞬間の着弾予測点と一致する（本番の地形）', () => {
    const impacts: Impact[] = [];
    const bay = new BombBay((i) => {
      impacts.push({ ...i });
    }, getGroundHeight);
    const s = landShooter();
    bay.step(s, [], () => true, DT);
    expect(bay.predictionValid).toBe(true);
    const predicted = { ...bay.prediction };
    bay.tryDrop(s);
    for (let i = 0; i < 20 * 60 && impacts.length === 0; i++) bay.step(null, [], () => true, DT);
    const hit = impacts[0];
    if (!hit) throw new Error('着弾しない');
    expect(Math.hypot(hit.x - predicted.x, hit.y - predicted.y, hit.z - predicted.z)).toBeLessThan(
      0.05,
    );
    expect(hit.y).toBeCloseTo(getHeight(hit.x, hit.z), 9);
  });

  it('着弾で表面から 40m 以内の敵側すべてに 300。外・プレイヤー側には入らない', () => {
    const s = new FlightSession({ rng: NO_SPREAD });
    s.startMission({ x: 0, y: 600, z: 0, headingDeg: 0 });
    s.spawn({
      kind: 'groundTarget',
      group: 'g',
      targetType: 'radar',
      trigger: { type: 'start' },
      positions: [
        { x: 0, z: 0 },
        { x: 0, z: -40 },
        { x: 0, z: -120 },
      ],
    });
    const [a, b, c] = s.props.groundTargets;
    if (!a || !b || !c) throw new Error('地上目標がない');
    s.combat.applyBlast(0, 0, -20, BOMB_CONFIG.blast, TEAM_PLAYER, TEAM_PLAYER);
    expect(a.hp).toBe(0);
    expect(b.hp).toBe(0);
    expect(c.hp).toBe(c.maxHp);
    expect(s.combat.kills).toBe(2);
  });

  it('戦闘の操作: B で投下、長押し（bombHeld）は着弾予測点が出ているときだけ投下する', () => {
    const s = new FlightSession({ groundHeight: () => 0, rng: NO_SPREAD });
    // 地面 0 から 3000m（落下 25 秒 > 15 秒）では予測点が出ない
    s.startMission({ x: 0, y: 3000, z: 0, headingDeg: 0 });
    const held = { ...createCombatInput(), bombHeld: true };
    s.combat.step(createCombatInput(), s.aircraft.state, DT);
    expect(s.combat.bombs.predictionValid).toBe(false);
    s.combat.step(held, s.aircraft.state, DT);
    expect(s.combat.bombs.count).toBe(4);
    s.combat.step({ ...createCombatInput(), bomb: true }, s.aircraft.state, DT);
    expect(s.combat.bombs.count).toBe(3);
    // 低空（500m）なら予測点が出て、長押しで落とせる
    s.startMission({ x: 0, y: 500, z: 0, headingDeg: 0 });
    s.combat.step(createCombatInput(), s.aircraft.state, DT);
    expect(s.combat.bombs.predictionValid).toBe(true);
    s.combat.step(held, s.aircraft.state, DT);
    expect(s.combat.bombs.count).toBe(3);
  });
});

/** 押しているアクションを指定できる偽の入力 */
class FakeInput implements ActionReader {
  readonly down = new Set<Action>();
  readonly pressed = new Set<Action>();
  isDown(a: Action): boolean {
    return this.down.has(a);
  }
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  press(a: Action): void {
    this.down.add(a);
    this.pressed.add(a);
  }
}

describe('長押しの操作（タッチ・パッド）', () => {
  function steps(
    w: WeaponInput,
    input: FakeInput,
    n: number,
  ): ReturnType<typeof createCombatInput>[] {
    const outs = [];
    for (let i = 0; i < n; i++) {
      const out = createCombatInput();
      w.read(input, out, DT);
      input.pressed.clear();
      outs.push(out);
    }
    return outs;
  }

  it('MSL を短く押して離すと今の兵装（初めはミサイル）を撃つ。0.4 秒押し続けるとロケットに切り替わり、撃たない', () => {
    const w = new WeaponInput();
    const input = new FakeInput();
    input.press('secondary');
    expect(steps(w, input, 5).some((o) => o.missile)).toBe(false);
    input.down.delete('secondary');
    const [release] = steps(w, input, 1);
    expect(release?.missile).toBe(true);
    expect(w.secondary).toBe('missile');

    input.press('secondary');
    steps(w, input, 24);
    expect(w.secondary).toBe('rocket');
    input.down.delete('secondary');
    expect(steps(w, input, 2).some((o) => o.missile || o.rocket)).toBe(false);

    // ステップの間に押して離した短いタップでも撃つ（ロケット）
    input.pressed.add('secondary');
    const [tap] = steps(w, input, 1);
    expect(tap?.rocket).toBe(true);
    expect(tap?.missile).toBe(false);
  });

  it('AB（bombHold）を 0.4 秒押し続けると 1 回だけ bombHeld。離して押し直すとまた', () => {
    const w = new WeaponInput();
    const input = new FakeInput();
    input.press('bombHold');
    const outs = steps(w, input, 60);
    const at = outs.findIndex((o) => o.bombHeld);
    expect(at).toBe(23);
    expect(outs.filter((o) => o.bombHeld).length).toBe(1);
    input.down.delete('bombHold');
    steps(w, input, 1);
    input.press('bombHold');
    expect(steps(w, input, 30).filter((o) => o.bombHeld).length).toBe(1);
  });

  it('パッドの Y（targetHold）: 短く押して離すとターゲット切替、0.4 秒押し続けると 1 回だけ bombHeld（切替なし）', () => {
    const w = new WeaponInput();
    const input = new FakeInput();
    input.press('targetHold');
    const press = steps(w, input, 10);
    expect(press.some((o) => o.targetNext || o.bombHeld)).toBe(false);
    input.down.delete('targetHold');
    const [release] = steps(w, input, 1);
    expect(release?.targetNext).toBe(true);
    expect(release?.bombHeld).toBe(false);

    input.press('targetHold');
    const outs = steps(w, input, 60);
    expect(outs.findIndex((o) => o.bombHeld)).toBe(23);
    expect(outs.filter((o) => o.bombHeld).length).toBe(1);
    input.down.delete('targetHold');
    expect(steps(w, input, 2).some((o) => o.targetNext || o.bombHeld)).toBe(false);

    // ステップの間に押して離した短いタップでも切り替える
    input.pressed.add('targetHold');
    const [tap] = steps(w, input, 1);
    expect(tap?.targetNext).toBe(true);
  });

  it('キーは G = ロケット・B = 爆弾、パッドは X = ロケット・Y = ターゲット切替 + 爆弾の長押し・RT = ヨー右だけ', () => {
    expect(DEFAULT_KEYBINDS.rocket).toEqual(['KeyG']);
    expect(DEFAULT_KEYBINDS.bomb).toEqual(['KeyB']);
    const buttons = Array.from({ length: 17 }, (_, i) => ({
      value: i === 2 || i === 7 ? 1 : 0,
      pressed: i === 2 || i === 7,
    }));
    const v = mapGamepad({ connected: true, axes: [0, 0, 0, 0], buttons }, createActionValues());
    expect(v[actionIndex('rocket')]).toBe(1);
    expect(v[actionIndex('yawRight')]).toBe(1);
    expect(v[actionIndex('bombHold')]).toBe(0);
    expect(DEFAULT_GAMEPAD_MAPPING.buttons[3]).toBe('targetHold');
    expect(DEFAULT_GAMEPAD_MAPPING.buttons[0]).toBe('missile');
  });
});
