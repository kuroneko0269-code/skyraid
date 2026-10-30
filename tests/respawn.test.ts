import { describe, expect, it } from 'vitest';
import { TEAM_ENEMY } from '../src/combat/target';
import { AIRCRAFT_COMBAT } from '../src/data/aircraft';
import type { AircraftControls } from '../src/entities/aircraft';
import { createCombatInput } from '../src/combat/combat-system';
import { FlightSession } from '../src/missions/flight-session';
import { getGroundHeight } from '../src/render/terrain-height';

const DT = 1 / 60;
const LEVEL: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };
const NONE = createCombatInput();

/** 復帰した直後のステップまで進める */
function waitRespawn(s: FlightSession): void {
  const limit = Math.round(AIRCRAFT_COMBAT.playerRespawnSeconds / DT) + 2;
  for (let i = 0; i < limit && !s.player.active; i++) s.step(LEVEL, NONE, DT);
}

describe('墜落後の復帰位置（4-6 の事前修正）', () => {
  it('フリーフライト: 地面に墜落すると、墜落地点の地表から 300m 上空に水平・同じ方位で戻る', () => {
    // 山の斜面の 20m 上を山頂（-Z）へ水平に飛ばし、斜面にぶつける
    const start = { x: 0, y: getGroundHeight(0, 1500) + 20, z: 1500 };
    const s = new FlightSession({ groundHeight: getGroundHeight, start });
    s.configureEnemies(false, 'normal');
    s.startFree();
    let crashed = false;
    for (let i = 0; i < 60 * 60 && !crashed; i++) {
      s.step(LEVEL, NONE, DT);
      crashed = !s.player.active;
    }
    expect(crashed).toBe(true);
    const wreck = { ...s.aircraft.state.position };
    waitRespawn(s);
    expect(s.player.active).toBe(true);
    const p = s.aircraft.state.position;
    expect(p.x).toBeCloseTo(wreck.x, 6);
    expect(p.z).toBeCloseTo(wreck.z, 6);
    expect(p.y).toBeCloseTo(getGroundHeight(wreck.x, wreck.z) + 300, 6);
    // 水平（ロール・ピッチなし）で、機首は墜落前と同じ方位（真っ直ぐ -Z へ飛んだので 0°）
    const q = s.aircraft.state.orientation;
    expect(Math.abs(q.x) + Math.abs(q.z)).toBeLessThan(1e-9);
    expect(Math.abs(q.y)).toBeLessThan(1e-6);
  });

  it('ミッション: 撃墜（墜落も）されると開始位置・開始方位へ戻る', () => {
    const s = new FlightSession({ groundHeight: getGroundHeight });
    const start = { x: 1200, y: 900, z: -2500, headingDeg: 90 };
    s.startMission(start);
    for (let i = 0; i < 120; i++) s.step(LEVEL, NONE, DT);
    s.combat.dealDamage(s.player, s.player.maxHp, TEAM_ENEMY);
    waitRespawn(s);
    expect(s.player.active).toBe(true);
    const p = s.aircraft.state.position;
    expect([p.x, p.y, p.z]).toEqual([start.x, start.y, start.z]);
    const q = s.aircraft.state.orientation;
    expect(q.y).toBeCloseTo(Math.sin((-90 * Math.PI) / 360), 9);
  });
});
