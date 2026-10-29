import { describe, expect, it } from 'vitest';
import { CAMERA_CONFIG, type CameraConfig } from '../src/data/camera';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import {
  CameraRig,
  chaseDistance,
  chaseFov,
  sampleCurve,
  type CameraTarget,
} from '../src/render/camera-rig';
import { CameraShake } from '../src/render/camera-shake';
import { SpringVec3, stepCriticalSpring } from '../src/render/spring';
import {
  quatFromRotationVector,
  quatIdentity,
  rotateVec3,
  vec3,
  type Vec3,
} from '../src/flight/math';

const DT = 1 / 60;
const chase = CAMERA_CONFIG.chase;
const speeds = STARTER_AIRCRAFT.speed;

function target(overrides: Partial<CameraTarget> = {}): CameraTarget {
  return {
    position: vec3(0, 300, 0),
    orientation: quatIdentity(),
    speed: speeds.cruise,
    afterburnerActive: false,
    stall: 0,
    angularRate: vec3(),
    ...overrides,
  };
}

function noShake(cfg: CameraConfig = CAMERA_CONFIG): CameraConfig {
  return { ...cfg, shake: { ...cfg.shake, stallAmplitude: 0, impactAmplitude: 0 } };
}

function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

describe('スプリング', () => {
  it('目標へ収束し、臨界減衰なので行き過ぎない', () => {
    const s = { value: 0, velocity: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      stepCriticalSpring(s, 10, 7, DT);
      max = Math.max(max, s.value);
    }
    expect(s.value).toBeCloseTo(10, 2);
    expect(max).toBeLessThanOrEqual(10);
  });

  it('大きな dt でも発散しない', () => {
    const s = { value: 0, velocity: 0 };
    stepCriticalSpring(s, 10, 14, 0.5);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value - 10)).toBeLessThan(1);
  });

  it('SpringVec3 は 3 軸とも収束する', () => {
    const s = new SpringVec3();
    const goal = vec3(5, -3, 20);
    for (let i = 0; i < 180; i++) s.update(goal, 5, DT);
    expect(dist(s.value, goal)).toBeLessThan(0.01);
  });
});

describe('速度と画角・距離', () => {
  it('巡航で基準値（画角 60°・距離 24m）', () => {
    expect(chaseFov(chase, speeds.cruise, 0)).toBe(60);
    expect(chaseDistance(chase, speeds.cruise, 0)).toBe(24);
  });

  it('速いほど画角が広く距離が長い', () => {
    let prevFov = -Infinity;
    let prevDist = -Infinity;
    for (let v = 60; v <= 480; v += 20) {
      const fov = chaseFov(chase, v, 0);
      const d = chaseDistance(chase, v, 0);
      expect(fov).toBeGreaterThanOrEqual(prevFov);
      expect(d).toBeGreaterThanOrEqual(prevDist);
      prevFov = fov;
      prevDist = d;
    }
    expect(chaseFov(chase, speeds.afterburner, 1)).toBeGreaterThan(
      chaseFov(chase, speeds.cruise, 0) + 10,
    );
  });

  it('折れ線の範囲外は端の値', () => {
    expect(sampleCurve(chase.fovCurve, 0)).toBe(57);
    expect(sampleCurve(chase.fovCurve, 1000)).toBe(73);
  });

  it('アフターバーナー点火で速度が変わる前から画角が広がる', () => {
    const rig = new CameraRig(noShake());
    rig.update(target(), 0, DT);
    const base = rig.pose.fov;
    for (let i = 0; i < 30; i++) rig.update(target({ afterburnerActive: true }), 0, DT);
    expect(rig.pose.fov).toBeGreaterThan(base + 3);
  });
});

describe('追従', () => {
  it('静止した機体の後方上空に収束する', () => {
    const rig = new CameraRig(noShake());
    const t = target();
    for (let i = 0; i < 120; i++) rig.update(t, 0, DT);
    const p = rig.pose.position;
    expect(p.x).toBeCloseTo(0, 3);
    expect(p.y).toBeCloseTo(300 + chase.height, 3);
    expect(p.z).toBeCloseTo(24, 3);
  });

  it('機体が高速で移動しても距離は速度の折れ線どおり（オフセットに追従する）', () => {
    const rig = new CameraRig(noShake());
    const pos = vec3(0, 300, 0);
    for (let i = 0; i < 300; i++) {
      pos.z -= speeds.afterburner * DT;
      rig.update(target({ position: pos, speed: speeds.afterburner }), 0, DT);
    }
    expect(rig.pose.position.z - pos.z).toBeCloseTo(chaseDistance(chase, speeds.afterburner, 0), 2);
  });

  it('ロールに遅れて追従する', () => {
    const rig = new CameraRig(noShake());
    rig.update(target(), 0, DT);
    const rolled = quatFromRotationVector(quatIdentity(), 0, 0, Math.PI / 2);
    const aircraftUp = rotateVec3(vec3(), rolled, vec3(0, 1, 0));
    rig.update(target({ orientation: rolled }), 0, DT);
    expect(dot(rig.pose.up, aircraftUp)).toBeLessThan(0.5);
    for (let i = 0; i < 180; i++) rig.update(target({ orientation: rolled }), 0, DT);
    expect(dot(rig.pose.up, aircraftUp)).toBeGreaterThan(0.99);
  });

  it('旋回中は注視点が曲がる側へずれる', () => {
    const rig = new CameraRig(noShake());
    const t = target({ angularRate: vec3(1, 0, 0) }); // 機首上げ
    for (let i = 0; i < 120; i++) rig.update(t, 0, DT);
    expect(rig.pose.lookAt.y).toBeGreaterThan(300 + 5);
  });

  it('宙返り・背面飛行でも機体の後方にいて、up が機体基準を保つ', () => {
    const rig = new CameraRig(noShake());
    const q = quatIdentity();
    const pos = vec3(0, 1000, 0);
    const rate = (2 * Math.PI) / 5; // 5 秒で 1 周
    const fwd = vec3();
    const up = vec3();
    for (let i = 0; i <= 300; i++) {
      quatFromRotationVector(q, rate * DT * i, 0, 0);
      rotateVec3(fwd, q, vec3(0, 0, -1));
      pos.x += fwd.x * speeds.cruise * DT;
      pos.y += fwd.y * speeds.cruise * DT;
      pos.z += fwd.z * speeds.cruise * DT;
      const pose = rig.update(
        target({ position: pos, orientation: q, angularRate: vec3(rate, 0, 0) }),
        0,
        DT,
      );
      rotateVec3(up, q, vec3(0, 1, 0));
      const back = vec3(pose.position.x - pos.x, pose.position.y - pos.y, pose.position.z - pos.z);
      expect(dot(back, fwd)).toBeLessThan(-10);
      expect(dot(pose.up, up)).toBeGreaterThan(0.7);
      expect(Math.hypot(pose.up.x, pose.up.y, pose.up.z)).toBeCloseTo(1, 6);
    }
  });

  it('固定後方はスプリングなしで即座に機体へ追従する', () => {
    const rig = new CameraRig(noShake());
    rig.update(target(), 0, DT);
    expect(rig.toggleMode()).toBe('fixed');
    const yawed = quatFromRotationVector(quatIdentity(), 0, Math.PI / 2, 0);
    const pose = rig.update(target({ orientation: yawed }), 0, DT);
    const expected = rotateVec3(
      vec3(),
      yawed,
      vec3(0, CAMERA_CONFIG.fixed.height, CAMERA_CONFIG.fixed.distance),
    );
    expect(pose.position.x).toBeCloseTo(expected.x, 6);
    expect(pose.position.y).toBeCloseTo(300 + expected.y, 6);
    expect(pose.position.z).toBeCloseTo(expected.z, 6);
    expect(rig.toggleMode()).toBe('chase');
  });
});

describe('最低高度', () => {
  it('地面すれすれの背面飛行でもカメラは地面より上', () => {
    const rig = new CameraRig(CAMERA_CONFIG);
    const inverted = quatFromRotationVector(quatIdentity(), 0, 0, Math.PI);
    rig.addImpact();
    for (let i = 0; i < 120; i++) {
      const pose = rig.update(
        target({ position: vec3(0, 1, -i), orientation: inverted, stall: 1 }),
        0,
        DT,
      );
      expect(pose.position.y).toBeGreaterThanOrEqual(CAMERA_CONFIG.minHeightAboveGround - 1e-9);
    }
  });

  it('地面の高さを基準にする', () => {
    const rig = new CameraRig(noShake());
    const pose = rig.update(target({ position: vec3(0, 50, 0) }), 100, DT);
    expect(pose.position.y).toBe(100 + CAMERA_CONFIG.minHeightAboveGround);
  });
});

describe('画面揺れ', () => {
  it('失速中は揺れ、強さ 0 なら揺れない', () => {
    const shake = new CameraShake(CAMERA_CONFIG.shake);
    const off = new CameraShake({ ...CAMERA_CONFIG.shake, stallAmplitude: 0 });
    let max = 0;
    for (let i = 0; i < 60; i++) {
      shake.update(1, DT);
      off.update(1, DT);
      max = Math.max(max, Math.hypot(shake.offset.x, shake.offset.y));
      expect(off.offset).toEqual({ x: 0, y: 0 });
    }
    expect(max).toBeGreaterThan(0.05);
    expect(max).toBeLessThanOrEqual(CAMERA_CONFIG.shake.stallAmplitude * Math.SQRT2);
  });

  it('衝突の揺れは減衰して止まる', () => {
    const shake = new CameraShake(CAMERA_CONFIG.shake);
    shake.addImpact();
    shake.update(0, DT);
    for (let i = 0; i < 240; i++) shake.update(0, DT);
    expect(shake.offset).toEqual({ x: 0, y: 0 });
  });
});
