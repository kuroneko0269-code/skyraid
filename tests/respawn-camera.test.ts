// リスポーン直後のカメラ（4-12b）: 撃墜・墜落のどちらでも、フリーフライト・ミッションのどちらでも、カメラは機体の新しい位置の
// 後方の標準オフセットにすぐ置かれ、ターゲットカメラの寄せ・揺れ・前の場所のスプリングを持ち越さない
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { TEAM_ENEMY } from '../src/combat/target';
import { AIRCRAFT_COMBAT } from '../src/data/aircraft';
import { CAMERA_CONFIG } from '../src/data/camera';
import type { AircraftControls } from '../src/entities/aircraft';
import { rotateVec3, vec3, type Vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { aircraftOnScreen } from '../src/render/camera-focus';
import { CameraRig, chaseDistance, type CameraTarget } from '../src/render/camera-rig';
import { getGroundHeight } from '../src/render/terrain-height';

const DT = 1 / 60;
const NONE = createCombatInput();
/** 右旋回しながら上昇（スプリングを標準オフセットから外しておく） */
const TURN: AircraftControls = { pitch: 0.4, roll: 0.7, yaw: 0, throttle: 0.8, afterburner: false };
const LEVEL: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };

function cameraTarget(s: FlightSession): CameraTarget {
  const st = s.aircraft.state;
  return {
    position: st.position,
    orientation: st.orientation,
    speed: st.speed,
    afterburnerActive: st.afterburnerActive,
    stall: st.stall,
    angularRate: st.angularRate,
  };
}

/** 機体の後方の標準オフセット（追従カメラ: 機体ローカルの (0, height, 距離)）にあるカメラ位置 */
function standardPosition(s: FlightSession): Vec3 {
  const st = s.aircraft.state;
  const c = CAMERA_CONFIG.chase;
  const local = vec3(0, c.height, chaseDistance(c, st.speed, 0));
  const o = rotateVec3(vec3(), st.orientation, local);
  return vec3(st.position.x + o.x, st.position.y + o.y, st.position.z + o.z);
}

function standardLookAt(s: FlightSession): Vec3 {
  const st = s.aircraft.state;
  const o = rotateVec3(vec3(), st.orientation, vec3(0, 0, -CAMERA_CONFIG.chase.lookAhead));
  return vec3(st.position.x + o.x, st.position.y + o.y, st.position.z + o.z);
}

/**
 * 旋回して落とされ（down で撃墜・墜落させる）、リスポーンした瞬間に main.ts と同じく rig.snapTo を呼ぶ。
 * 撃墜中も描画フレームごとにカメラを動かし、ターゲットカメラは機体の真横の遠くの点へ寄せ続ける
 */
function flyAndRespawn(
  s: FlightSession,
  down: (s: FlightSession) => void,
): { rig: CameraRig; s: FlightSession } {
  const rig = new CameraRig(CAMERA_CONFIG);
  const side = vec3();
  const state = { snapped: false };
  s.onRespawn(() => {
    rig.snapTo(
      cameraTarget(s),
      getGroundHeight(s.aircraft.state.position.x, s.aircraft.state.position.z),
    );
    state.snapped = true;
  });
  s.onPlayerDown(() => {
    rig.addImpact();
  });
  const frame = (controls: AircraftControls): void => {
    s.step(controls, NONE, DT);
    if (state.snapped) return;
    const p = s.aircraft.state.position;
    side.x = p.x + 3000;
    side.y = p.y;
    side.z = p.z;
    rig.focus = side;
    rig.update(cameraTarget(s), -1000, DT);
  };
  for (let i = 0; i < 180; i++) frame(TURN);
  down(s);
  const limit = Math.round(AIRCRAFT_COMBAT.playerRespawnSeconds / DT) + 600;
  for (let i = 0; i < limit && !state.snapped; i++) frame(s.player.active ? TURN : LEVEL);
  expect(state.snapped).toBe(true);
  return { rig, s };
}

function expectStandard(rig: CameraRig, s: FlightSession): void {
  const pose = rig.pose;
  const want = standardPosition(s);
  expect(pose.position.x).toBeCloseTo(want.x, 6);
  expect(pose.position.y).toBeCloseTo(want.y, 6);
  expect(pose.position.z).toBeCloseTo(want.z, 6);
  const look = standardLookAt(s);
  expect(pose.lookAt.x).toBeCloseTo(look.x, 6);
  expect(pose.lookAt.y).toBeCloseTo(look.y, 6);
  expect(pose.lookAt.z).toBeCloseTo(look.z, 6);
  // 機体は画面の左右の真ん中（ターゲットカメラの寄せ・揺れを持ち越さない）
  const sp = aircraftOnScreen(pose, s.aircraft.state.position, vec3(), 0, { x: 0, y: 0 });
  expect(Math.abs(sp?.x ?? 1)).toBeLessThan(1e-9);
}

/** リスポーンの後、最初の描画フレーム（実時間 dt 進める）でもカメラの位置は標準オフセットのまま */
function expectFirstFrame(rig: CameraRig, s: FlightSession): void {
  s.step(LEVEL, NONE, DT);
  rig.update(cameraTarget(s), -1000, DT);
  const want = standardPosition(s);
  const p = rig.pose.position;
  expect(Math.hypot(p.x - want.x, p.y - want.y, p.z - want.z)).toBeLessThan(0.05);
}

describe('リスポーン直後のカメラ（4-12b）', () => {
  it('フリーフライト・撃墜: 機体の新しい位置の後方の標準オフセットに置く', () => {
    const s = new FlightSession({ groundHeight: getGroundHeight });
    s.configureEnemies(false, 'normal');
    s.startFree();
    const { rig } = flyAndRespawn(s, (x) => {
      x.combat.dealDamage(x.player, x.player.maxHp, TEAM_ENEMY);
    });
    expectStandard(rig, s);
    expectFirstFrame(rig, s);
  });

  it('フリーフライト・墜落（地面）: 同じく標準オフセット', () => {
    const start = { x: 0, y: getGroundHeight(0, 1500) + 20, z: 1500 };
    const s = new FlightSession({ groundHeight: getGroundHeight, start });
    s.configureEnemies(false, 'normal');
    s.startFree();
    // 山の斜面へ向けて水平に飛ばし、ぶつける（旋回しないで落ちるまで）
    const { rig } = flyAndRespawn(s, () => undefined);
    expect(s.player.downCount).toBeGreaterThan(0);
    expectStandard(rig, s);
    expectFirstFrame(rig, s);
  });

  it('ミッション・撃墜: 開始位置・開始方位へ戻り、カメラもそこへ', () => {
    const s = new FlightSession({ groundHeight: getGroundHeight });
    const start = { x: 1200, y: 900, z: -2500, headingDeg: 90 };
    s.startMission(start);
    const { rig } = flyAndRespawn(s, (x) => {
      x.combat.dealDamage(x.player, x.player.maxHp, TEAM_ENEMY);
    });
    const p = s.aircraft.state.position;
    expect([p.x, p.y, p.z]).toEqual([start.x, start.y, start.z]);
    expectStandard(rig, s);
    expectFirstFrame(rig, s);
  });

  it('snap だけ（次の update まで待つ）と違い、snapTo はその場で pose を置き直す', () => {
    const rig = new CameraRig(CAMERA_CONFIG);
    const t: CameraTarget = {
      position: vec3(0, 500, 0),
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      speed: 250,
      afterburnerActive: false,
      stall: 0,
      angularRate: vec3(),
    };
    rig.update(t, 0, DT);
    const moved: CameraTarget = { ...t, position: vec3(5000, 800, -3000) };
    rig.addImpact(1);
    const pose = rig.snapTo(moved, 0);
    const d = chaseDistance(CAMERA_CONFIG.chase, 250, 0);
    expect(pose.position.x).toBeCloseTo(5000, 9);
    expect(pose.position.y).toBeCloseTo(800 + CAMERA_CONFIG.chase.height, 9);
    expect(pose.position.z).toBeCloseTo(-3000 + d, 9);
  });
});
