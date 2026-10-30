// 4-2c: 「敵 OFF」で敵機・敵のミサイルが残らない / 再出現しないこと
import { describe, expect, it } from 'vitest';
import type { CombatInput } from '../src/combat/combat-system';
import { TEAM_ENEMY, TEAM_PLAYER } from '../src/combat/target';
import type { AircraftControls } from '../src/entities/aircraft';
import { FreeFlight } from '../src/missions/free-flight';

const NONE: CombatInput = { trigger: false, missile: false, flare: false, targetNext: false };
const LEVEL: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };
const DT = 1 / 60;

function run(ff: FreeFlight, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ff.step(LEVEL, NONE, DT);
    each?.();
  }
}

const activeEnemies = (ff: FreeFlight): number => ff.enemies.filter((e) => e.active).length;

function enemyMissiles(ff: FreeFlight): number {
  const pool = ff.combat.missiles.missiles;
  let n = 0;
  for (let i = 0; i < pool.count; i++) if (pool.get(i).owner === TEAM_ENEMY) n++;
  return n;
}

describe('敵 OFF（4-2c）', () => {
  it('OFF のままフリーフライトを始めて 60 秒進めても敵は 0 機', () => {
    const ff = new FreeFlight({ rng: () => 0.5 });
    ff.configureEnemies(false, 'normal');
    ff.reset();
    let max = 0;
    run(ff, 60, () => {
      max = Math.max(max, activeEnemies(ff), enemyMissiles(ff));
    });
    expect(max).toBe(0);
    expect(ff.enemies.every((e) => !e.deployed)).toBe(true);
  });

  it('途中で OFF にすると敵機と敵のミサイル・フレアがその場で消え、再出現もしない', () => {
    const ff = new FreeFlight({ rng: () => 0.5 });
    ff.configureEnemies(true, 'normal');
    ff.reset();
    run(ff, 5);
    expect(activeEnemies(ff)).toBeGreaterThan(0);
    // 1 機は撃墜されて再出現待ち、もう 1 機はミサイルとフレアを出している状態にする
    const [downed, shooter] = ff.enemies;
    if (!downed || !shooter) throw new Error('敵機がいない');
    downed.applyDamage(downed.hp);
    ff.combat.missiles.launch(shooter.aircraft.state, ff.player, TEAM_ENEMY);
    ff.combat.flares.release(shooter.aircraft.state, TEAM_ENEMY);
    expect(enemyMissiles(ff)).toBe(1);

    ff.configureEnemies(false, 'normal');
    expect(activeEnemies(ff)).toBe(0);
    expect(enemyMissiles(ff)).toBe(0);
    const flares = ff.combat.flares.flares;
    for (let i = 0; i < flares.count; i++) expect(flares.get(i).owner).not.toBe(TEAM_ENEMY);

    let max = 0;
    run(ff, 60, () => {
      max = Math.max(max, activeEnemies(ff), enemyMissiles(ff));
    });
    expect(max).toBe(0);
  });

  it('ON に戻すと出現し、OFF でもプレイヤーのミサイルは消さない', () => {
    const ff = new FreeFlight({ rng: () => 0.5 });
    ff.configureEnemies(false, 'normal');
    ff.reset();
    ff.combat.missiles.launch(ff.aircraft.state, null, TEAM_PLAYER);
    ff.configureEnemies(false, 'hard');
    expect(ff.combat.missiles.missiles.count).toBe(1);
    ff.configureEnemies(true, 'normal');
    expect(activeEnemies(ff)).toBe(ff.squadron.count);
  });
});
