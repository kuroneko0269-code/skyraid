// ゲームの状態から HUD に渡す 1 フレーム分の値を作る（毎フレーム同じオブジェクトに書き込む）
import type { CombatSystem } from '../combat/combat-system';
import type { Aircraft, GroundHeightFn } from '../entities/aircraft';
import type { HudFrame } from './hud';

export function createHudFrame(aircraft: Aircraft): HudFrame {
  return {
    speed: 0,
    throttle: 0,
    afterburnerGauge: 0,
    afterburnerActive: false,
    afterburnerLocked: false,
    x: 0,
    y: 0,
    z: 0,
    altitudeAboveGround: 0,
    stall: 0,
    orientation: aircraft.state.orientation,
    flightPath: null,
    gunHeat: 0,
    gunOverheated: false,
    hitMarker: false,
    kills: 0,
  };
}

/** 機体と射撃の状態を frame に書く。進行方向マーカー（flightPath）は呼び出し側で入れる */
export function fillHudFrame(
  frame: HudFrame,
  aircraft: Aircraft,
  combat: CombatSystem,
  groundHeight: GroundHeightFn,
): void {
  const state = aircraft.state;
  const p = state.position;
  frame.speed = state.speed;
  frame.throttle = aircraft.throttle;
  frame.afterburnerGauge = state.afterburnerGauge;
  frame.afterburnerActive = state.afterburnerActive;
  frame.afterburnerLocked = state.afterburnerLocked;
  frame.x = p.x;
  frame.y = p.y;
  frame.z = p.z;
  frame.altitudeAboveGround = p.y - groundHeight(p.x, p.z);
  frame.stall = state.stall;
  frame.gunHeat = combat.gun.heat.value;
  frame.gunOverheated = combat.gun.heat.overheated;
  frame.hitMarker = combat.hitMarkerTimer > 0;
  frame.kills = combat.kills;
}
