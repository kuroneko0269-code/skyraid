// 操作補助（4-12）: エイムアシスト・機銃の当たり判定の拡大・ターゲットカメラ・HUD 補助・最後に操作した入力系統
import { describe, expect, it } from 'vitest';
import { applyAimAssist } from '../src/combat/aim-assist';
import { Gun, type GunTarget } from '../src/combat/gun';
import { AssistControl } from '../src/core/assist-control';
import type { AssistFlags } from '../src/core/assist-settings';
import { Input, type InputDevice } from '../src/core/input';
import { createRandom } from '../src/core/random';
import { AIM_ASSIST_CONFIG, HUD_ASSIST_CONFIG, TARGET_CAMERA_CONFIG } from '../src/data/assist';
import { CAMERA_CONFIG } from '../src/data/camera';
import { HUD_CONFIG } from '../src/data/hud';
import { GUN_CONFIG } from '../src/data/weapons';
import { createControls } from '../src/entities/aircraft';
import type { Vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { aircraftOnScreen, CameraFocus } from '../src/render/camera-focus';
import { CameraRig, type CameraTarget } from '../src/render/camera-rig';
import { createHudFrame, fillHudFrame } from '../src/ui/hud-feed';
import { DEG, DT, IDENTITY, lookQuat } from './combat-helpers';
import { arenaForce } from './ai-sim';

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** 機首（-Z）から右へ yawDeg・上へ pitchDeg ずれた 1000m 先の点 */
function aimAt(yawDeg: number, pitchDeg: number): Vec3 {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  return {
    x: Math.sin(y) * Math.cos(p) * 1000,
    y: Math.sin(p) * 1000,
    z: -Math.cos(y) * Math.cos(p) * 1000,
  };
}

describe('エイムアシスト（入力の補正）', () => {
  it('操縦の入力が 0 なら何もしない（勝手に追わない）', () => {
    const c = createControls();
    expect(applyAimAssist(c, ORIGIN, IDENTITY, aimAt(3, 2), false)).toBe(false);
    expect([c.pitch, c.yaw, c.roll]).toEqual([0, 0, 0]);
  });

  it('機首から 8° 以内なら、対象の側へピッチ・ヨーを足す（最大 25%）', () => {
    const c = createControls();
    c.roll = 0.5;
    expect(applyAimAssist(c, ORIGIN, IDENTITY, aimAt(5, 4), false)).toBe(true);
    // 右上にあるので機首上げ・機首右
    expect(c.pitch).toBeGreaterThan(0);
    expect(c.yaw).toBeGreaterThan(0);
    expect(c.pitch).toBeLessThanOrEqual(AIM_ASSIST_CONFIG.maxCorrection + 1e-9);
    expect(c.yaw).toBeLessThanOrEqual(AIM_ASSIST_CONFIG.maxCorrection + 1e-9);
    expect(c.roll).toBe(0.5);
    // 左下なら逆向き
    const d = createControls();
    d.pitch = 0.3;
    applyAimAssist(d, ORIGIN, IDENTITY, aimAt(-2, -2), false);
    expect(d.pitch).toBeLessThan(0.3);
    expect(d.yaw).toBeLessThan(0);
  });

  it('8° より外・後ろの対象には効かない。角度の差が小さいほど補正も小さい', () => {
    const c = createControls();
    c.pitch = 0.5;
    expect(applyAimAssist(c, ORIGIN, IDENTITY, aimAt(9, 0), false)).toBe(false);
    expect(applyAimAssist(c, ORIGIN, IDENTITY, { x: 0, y: 0, z: 1000 }, false)).toBe(false);
    expect(c.pitch).toBe(0.5);
    const small = createControls();
    small.roll = 1;
    applyAimAssist(small, ORIGIN, IDENTITY, aimAt(1, 0), false);
    const large = createControls();
    large.roll = 1;
    applyAimAssist(large, ORIGIN, IDENTITY, aimAt(4, 0), false);
    expect(small.yaw).toBeGreaterThan(0);
    expect(small.yaw).toBeLessThan(large.yaw);
    expect(large.yaw).toBeCloseTo(AIM_ASSIST_CONFIG.maxCorrection, 6);
  });

  it('入力が小さいと補正も弱い（fullInput 未満は入力に比例）。ピッチ反転では補正も反転する', () => {
    const weak = createControls();
    weak.roll = AIM_ASSIST_CONFIG.fullInput / 2;
    applyAimAssist(weak, ORIGIN, IDENTITY, aimAt(0, 5), false);
    expect(weak.pitch).toBeCloseTo(AIM_ASSIST_CONFIG.maxCorrection / 2, 6);
    const inv = createControls();
    inv.roll = 1;
    applyAimAssist(inv, ORIGIN, IDENTITY, aimAt(0, 5), true);
    expect(inv.pitch).toBeCloseTo(-AIM_ASSIST_CONFIG.maxCorrection, 6);
  });

  it('機体の姿勢（ロール・向き）を考えて機体ローカルで補正する', () => {
    // 東（+X）を向いた機体から、少し北（-Z）= 左にある対象 → 機首左（yaw −）
    const q = lookQuat({ x: 1, y: 0, z: 0 });
    const c = createControls();
    c.pitch = 0.4;
    applyAimAssist(c, ORIGIN, q, { x: 1000, y: 0, z: -40 }, false);
    expect(c.yaw).toBeLessThan(0);
  });
});

describe('エイムアシストの切り替え（AssistControl）', () => {
  function setup(device: InputDevice, aim = true) {
    const s = new FlightSession({ rng: createRandom(3), enemies: arenaForce(1, 600) });
    s.configureEnemies(true, 'easy', 1);
    s.reset();
    const flags: AssistFlags = { aim, camera: true, hud: true };
    return { s, control: new AssistControl(s, flags, () => device) };
  }

  it('タッチ・パッドで ON なら機銃の当たり判定の半径 1.3 倍、キーボード・OFF なら 1 倍（従来どおり）', () => {
    for (const [device, aim, scale] of [
      ['touch', true, AIM_ASSIST_CONFIG.gunHitRadiusScale],
      ['gamepad', true, AIM_ASSIST_CONFIG.gunHitRadiusScale],
      ['keyboard', true, 1],
      ['touch', false, 1],
    ] as const) {
      const { s, control } = setup(device, aim);
      control.apply(createControls());
      expect([device, aim, s.combat.gun.hitRadiusScale]).toEqual([device, aim, scale]);
    }
  });

  it('OFF・キーボードでは操縦の入力を変えない', () => {
    for (const [device, aim] of [
      ['keyboard', true],
      ['touch', false],
    ] as const) {
      const { s, control } = setup(device, aim);
      const target = s.enemies[0];
      if (!target) throw new Error('敵機がいない');
      s.combat.targeting.select(target);
      const c = createControls();
      c.pitch = 0.3;
      control.apply(c);
      expect([c.pitch, c.yaw]).toEqual([0.3, 0]);
    }
  });
});

describe('機銃の当たり判定の拡大', () => {
  it('半径 6m の対象の 7m 横を通る弾は、倍率 1 では外れ、1.3（7.8m）では当たる', () => {
    const hitsWith = (scale: number): number => {
      let hits = 0;
      const gun = new Gun({ ...GUN_CONFIG, spreadDeg: 0, gravity: 0 }, (h) => {
        if (h.target) hits++;
      });
      gun.hitRadiusScale = scale;
      const t: GunTarget = { position: { x: 7, y: -0.3, z: -500 }, hitRadius: 6, active: true };
      const shooter = { position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY, speed: 0 };
      gun.step(true, shooter, [t], DT);
      for (let i = 0; i < 60; i++) gun.step(false, shooter, [t], DT);
      return hits;
    };
    expect(hitsWith(1)).toBe(0);
    expect(hitsWith(AIM_ASSIST_CONFIG.gunHitRadiusScale)).toBe(1);
  });
});

describe('最後に操作した入力系統', () => {
  it('キーを押すとキーボード、タッチ・パッドの値が 0 より大きくなるとその系統', () => {
    const input = new Input();
    expect(input.lastDevice).toBe('keyboard');
    input.setAnalog('touch', 'pitchUp', 0.4);
    expect(input.lastDevice).toBe('touch');
    // 0 を送るだけでは切り替わらない（パッドは毎フレーム 0 を送る）
    input.setAnalog('gamepad', 'pitchUp', 0);
    expect(input.lastDevice).toBe('touch');
    input.setAnalog('gamepad', 'rollLeft', 0.7);
    expect(input.lastDevice).toBe('gamepad');
    input.handleKeyDown({ code: 'KeyW' });
    expect(input.lastDevice).toBe('keyboard');
  });
});

describe('ターゲットカメラ（CameraFocus）', () => {
  /** 原点から -Z を見るカメラ（注視点は 54m 先）、自機は 24m 先の少し下 */
  function pose(fov = 60): { position: Vec3; lookAt: Vec3; up: Vec3; fov: number } {
    return {
      position: { x: 0, y: 0, z: 0 },
      lookAt: { x: 0, y: 0, z: -54 },
      up: { x: 0, y: 1, z: 0 },
      fov,
    };
  }

  /** 自機の画面上の位置（視線の正面からの角度、度） */
  function aircraftDeg(look: Vec3): { x: number; y: number } {
    const sp = aircraftOnScreen({ ...pose(), lookAt: look }, aircraft, ORIGIN, 0, { x: 0, y: 0 });
    if (!sp) throw new Error('自機がカメラの後ろ');
    return { x: Math.atan(sp.x) / DEG, y: Math.atan(sp.y) / DEG };
  }
  const aircraft: Vec3 = { x: 0, y: -6, z: -24 };

  function settle(focus: Vec3 | null, aspect = 16 / 9, f = new CameraFocus()): Vec3 {
    let p = pose();
    for (let i = 0; i < 300; i++) {
      p = pose();
      f.apply(p, aircraft, focus, aspect, DT);
    }
    return p.lookAt;
  }

  function viewAngleTo(lookAt: Vec3, target: Vec3): number {
    const a = lookAt;
    const d =
      (a.x * target.x + a.y * target.y + a.z * target.z) /
      (Math.hypot(a.x, a.y, a.z) * Math.hypot(target.x, target.y, target.z));
    return Math.acos(Math.min(1, d)) / DEG;
  }

  it('対象が画面の中ほど・対象なし（OFF）なら視線は変えない', () => {
    const center = settle({ x: 100, y: 0, z: -1000 });
    expect(center).toEqual({ x: 0, y: 0, z: -54 });
    expect(settle(null)).toEqual({ x: 0, y: 0, z: -54 });
  });

  it('画面の外に出そうな対象（右 70°）へ視線を最大 15° 寄せる。自機は画面の端から 8° 内側に残る', () => {
    const target = { x: Math.sin(70 * DEG) * 1000, y: 0, z: -Math.cos(70 * DEG) * 1000 };
    const look = settle(target);
    const shift = viewAngleTo(look, { x: 0, y: 0, z: -1 });
    expect(look.x).toBeGreaterThan(0);
    expect(shift).toBeGreaterThan(10);
    expect(shift).toBeLessThanOrEqual(TARGET_CAMERA_CONFIG.maxShiftDeg + 1e-6);
    // 横の半分の画角は atan(tan 30° × 16/9) ≈ 45.8°
    const halfH = Math.atan(Math.tan(30 * DEG) * (16 / 9)) / DEG;
    const a = aircraftDeg(look);
    expect(Math.abs(a.x)).toBeLessThanOrEqual(halfH - TARGET_CAMERA_CONFIG.aircraftMarginDeg + 0.1);
    expect(Math.abs(a.y)).toBeLessThanOrEqual(30 - TARGET_CAMERA_CONFIG.aircraftMarginDeg + 0.1);
  });

  it('真上の対象では、自機（視線の 14° 下）が画面の下端から 8° 内側に残るところまでしか寄せない', () => {
    const look = settle({ x: 0, y: 1000, z: -10 });
    const shift = viewAngleTo(look, { x: 0, y: 0, z: -1 });
    expect(look.y).toBeGreaterThan(0);
    expect(shift).toBeGreaterThan(5);
    expect(shift).toBeLessThan(TARGET_CAMERA_CONFIG.maxShiftDeg - 1);
    expect(aircraftDeg(look).y).toBeCloseTo(-(30 - TARGET_CAMERA_CONFIG.aircraftMarginDeg), 0);
  });

  it('CameraRig: focus が null なら 4-12 より前と同じ姿勢', () => {
    const target: CameraTarget = {
      position: { x: 0, y: 1000, z: 0 },
      orientation: IDENTITY,
      speed: 250,
      afterburnerActive: false,
      stall: 0,
      angularRate: { x: 0, y: 0, z: 0 },
    };
    const a = new CameraRig(CAMERA_CONFIG);
    const b = new CameraRig(CAMERA_CONFIG);
    b.focus = { x: 0, y: 1000, z: -1000 };
    for (let i = 0; i < 30; i++) {
      a.update(target, 0, DT);
      b.update(target, 0, DT);
    }
    // 正面の対象なら寄せない
    expect(b.pose.lookAt).toEqual(a.pose.lookAt);
    expect(a.pose.lookAt.z).toBeCloseTo(-CAMERA_CONFIG.chase.lookAhead, 6);
  });
});

describe('HUD 補助の値（hud-feed）', () => {
  function session() {
    const s = new FlightSession({
      rng: createRandom(5),
      start: { x: 30000, y: 1500, z: 0 },
      enemies: arenaForce(1, 1000),
    });
    s.configureEnemies(true, 'easy', 1);
    s.reset();
    return s;
  }

  it('選択中の対象への角度差と向き（画面の上から時計回り）。OFF なら出さない', () => {
    const s = session();
    const e = s.enemies[0];
    if (!e) throw new Error('敵機がいない');
    s.combat.targeting.select(e);
    // 自機は -Z 向き。敵機を真右（+X）1000m に置く
    const p = s.aircraft.state.position;
    e.aircraft.state.position.x = p.x + 1000;
    e.aircraft.state.position.y = p.y;
    e.aircraft.state.position.z = p.z;
    const f = createHudFrame(s.aircraft);
    fillHudFrame(f, s, () => 0, true);
    expect(f.assist.arrowShown).toBe(true);
    expect(f.assist.angleDeg).toBeCloseTo(90, 3);
    expect(f.assist.arrowDeg).toBeCloseTo(90, 3);
    expect(f.assist.distance).toBeCloseTo(1000, 3);
    fillHudFrame(f, s, () => 0, false);
    expect(f.assist.enabled).toBe(false);
    expect(f.assist.arrowShown).toBe(false);
  });

  it('接近は approach、離脱は recede。後方 60°・1500m 以内の敵機は BEHIND とレーダーの点', () => {
    const s = session();
    const e = s.enemies[0];
    if (!e) throw new Error('敵機がいない');
    s.combat.targeting.select(e);
    const p = s.aircraft.state.position;
    const f = createHudFrame(s.aircraft);
    // 真後ろ 800m・400m 上（後ろは +Z）。自機は -Z へ 250 m/s、敵機は止まっている → 離れていく
    e.aircraft.state.position.x = p.x;
    e.aircraft.state.position.y = p.y + 400;
    e.aircraft.state.position.z = p.z + 800;
    e.velocity.x = e.velocity.y = e.velocity.z = 0;
    fillHudFrame(f, s, () => 0, true);
    expect(f.assist.closing).toBe('recede');
    expect(f.assist.behind).toBe(true);
    expect(f.radar.contacts[0]?.behind).toBe(true);
    expect(f.radar.contacts[0]?.altitude).toBe('above');
    // 前方なら近づく・BEHIND ではない。高度差が小さければ印なし
    e.aircraft.state.position.z = p.z - 800;
    e.aircraft.state.position.y = p.y + HUD_ASSIST_CONFIG.altitudeThreshold - 10;
    fillHudFrame(f, s, () => 0, true);
    expect(f.assist.closing).toBe('approach');
    expect(f.assist.behind).toBe(false);
    expect(f.radar.contacts[0]?.altitude).toBe('');
    // 後ろでも 1500m より遠ければ出さない
    e.aircraft.state.position.z = p.z + HUD_ASSIST_CONFIG.behind.range + 100;
    fillHudFrame(f, s, () => 0, true);
    expect(f.assist.behind).toBe(false);
  });

  it('レーダーの直径は 4-12 で 1.3 倍（156 / 114px）', () => {
    expect(HUD_CONFIG.radar.size).toBe(156);
    expect(HUD_CONFIG.radar.compactSize).toBe(Math.round(88 * 1.3));
    expect(HUD_CONFIG.radar.size).toBe(Math.round(120 * 1.3));
  });
});
