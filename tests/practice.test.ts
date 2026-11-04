// 練習場（9-5）: 課題の定義・進行（数え → 課題 → 時間切れ）・撃墜されない / 撃ち返さない・機銃だけ・動く的の経路・
// 狙いの指標が 9-1 の解析と同じ値（スコア・記録・リプレイ・文は practice-records.test.ts）
import { describe, expect, it } from 'vitest';
import { ControlAnalyzer } from '../scripts/replay-analysis/metrics';
import { createCombatInput } from '../src/combat/combat-input';
import { ISLAND_MAP } from '../src/data/maps';
import { PRACTICE_CONFIG, PRACTICE_DRILLS, type DronePathDef } from '../src/data/practice';
import { DRONE_CONFIG, type DroneOrbit } from '../src/data/targets';
import { TargetDrone } from '../src/entities/target-drone';
import { getGroundHeight } from '../src/render/terrain-height';
import { AVERAGE, BEGINNER, VETERAN } from './ai-sim';
import { DT, newPlay } from './mission-bots';
import { PracticeBot, runPractice } from './practice-bot';

const floor = (x: number, z: number): number => Math.max(0, getGroundHeight(x, z));
const ORBIT: DroneOrbit = { centerX: 0, centerZ: 0, radius: 2400, altitude: 800, phase: 0 };

describe('練習場の課題', () => {
  it('課題は 3 つ（止まった的・動く的・模擬の敵）。1 回は 60〜90 秒', () => {
    expect([...PRACTICE_DRILLS]).toEqual(['static', 'moving', 'bandit']);
    for (const d of PRACTICE_DRILLS) {
      expect(PRACTICE_CONFIG.durations[d]).toBeGreaterThanOrEqual(60);
      expect(PRACTICE_CONFIG.durations[d]).toBeLessThanOrEqual(90);
    }
  });

  it('開始位置は戦域の中で地表から 300m 以上。動く的の経路は全体で地表から 100m 以上', () => {
    for (const d of PRACTICE_DRILLS) {
      const s = PRACTICE_CONFIG.starts[d];
      expect(Math.hypot(s.x, s.z)).toBeLessThan(ISLAND_MAP.radius);
      expect(s.y - floor(s.x, s.z)).toBeGreaterThan(300);
    }
    for (const path of PRACTICE_CONFIG.dronePaths) {
      const d = new TargetDrone(ORBIT, DRONE_CONFIG);
      d.setPath(path);
      for (let t = 0; t < path.length / path.speed; t += 0.5) {
        d.pathTime = t;
        d.step(0);
        expect(d.position.y - floor(d.position.x, d.position.z)).toBeGreaterThan(100);
        expect(Math.hypot(d.position.x, d.position.z)).toBeLessThan(ISLAND_MAP.radius);
      }
    }
  });

  it('動く的: 直進・蛇行・上下。端まで行くと始めへ戻り、撃墜から respawnSeconds で始めから出直す', () => {
    const [straight, weave, bob] = PRACTICE_CONFIG.dronePaths as readonly DronePathDef[];
    expect(straight?.weave ?? straight?.bob).toBeUndefined();
    expect(weave?.weave).toBeDefined();
    expect(bob?.bob).toBeDefined();
    if (!weave) return;
    const d = new TargetDrone(ORBIT, DRONE_CONFIG);
    d.setPath(weave);
    expect(d.position).toMatchObject(weave.from);
    // 蛇行の 1/4 周期で横に振幅だけずれ、速さは進む向き + 横
    for (let i = 0; i < 120; i++) d.step(1 / 60);
    const quarter = (weave.weave?.period ?? 0) / 4;
    for (let i = 0; i < Math.round((quarter - 2) * 60); i++) d.step(1 / 60);
    expect(Math.abs(d.position.z - weave.from.z)).toBeCloseTo(weave.weave?.amplitude ?? 0, 0);
    // 撃墜 → 3 秒で始めから
    d.applyDamage(1000);
    expect(d.active).toBe(false);
    for (let i = 0; i < weave.respawnSeconds * 60 + 1; i++) d.step(1 / 60);
    expect(d.active).toBe(true);
    expect(d.pathTime).toBeLessThan(0.1);
    // 端まで行くと始めへ（撃墜ではない）
    for (let i = 0; i < (weave.length / weave.speed) * 60 + 2; i++) d.step(1 / 60);
    expect(d.active).toBe(true);
    expect(d.pathTime).toBeLessThan(0.1);
    // 経路を外すと周回に戻る
    d.setPath(null);
    expect(d.position.y).toBe(ORBIT.altitude);
  });

  it('数え 3 秒（開始位置に止める・撃てない）→ 課題 → 時間切れで結果。結果の画面へは 1.5 秒後', () => {
    const play = newPlay(1);
    const p = play.startPractice('static', 2.16);
    const bot = new PracticeBot(play, 'static');
    const start = { ...play.session.aircraft.state.position };
    for (let i = 0; i < 60 * 2; i++) {
      bot.think(DT);
      bot.input.trigger = true;
      play.step(bot.controls, bot.input, DT);
    }
    expect(p.phase).toBe('countdown');
    expect(play.session.combat.gun.shotCount).toBe(0);
    expect(play.session.aircraft.state.position.z).toBeCloseTo(start.z, 3);
    const done = runPractice(newPlay(1), 'static');
    expect(done.phase).toBe('finished');
    expect(done.result?.seconds).toBe(PRACTICE_CONFIG.durations.static);
    expect(done.readyForResult).toBe(true);
  });

  it('ボット: どの課題も撃墜でき、熟練者役は初心者役より高い。自機は撃墜されず、ミサイルは撃たない', () => {
    for (const drill of PRACTICE_DRILLS) {
      const scores = [BEGINNER, AVERAGE, VETERAN].map((skill) => {
        const play = newPlay(3);
        const missiles = play.session.combat.missileAmmo.capacity;
        const p = runPractice(play, drill, skill, 1);
        expect(play.session.player.downCount, drill).toBe(0);
        expect(play.session.combat.missileAmmo.count, drill).toBe(missiles);
        return p.result?.score ?? -1;
      });
      expect(scores[2], drill).toBeGreaterThan(0);
      // 止まった的のボット（上空から降下して撃つ）は腕前の差を持たない
      if (drill !== 'static') expect(scores[2], drill).toBeGreaterThan(scores[0] ?? 0);
    }
  });

  it('模擬の敵は撃ち返さない（機銃もミサイルも）。落とすと 3 秒後に次の 1 機が出る', () => {
    const play = newPlay(5);
    const p = runPractice(play, 'bandit', VETERAN, 2);
    expect(p.kills).toBeGreaterThan(1);
    expect(play.session.player.damageTaken).toBe(0);
    expect(play.session.enemies.filter((e) => e.active).length).toBeLessThanOrEqual(1);
  });

  it('墜落しても終わらない（上空へ戻る）', () => {
    const play = newPlay(1);
    const p = play.startPractice('static', 2.16);
    const c = { pitch: -1, roll: 0, yaw: 0, throttle: 0, afterburner: false, throttleTarget: 1 };
    const crashes = play.session.aircraft.crashCount;
    for (let i = 0; i < 60 * 40; i++) play.step(c, createCombatInput(), DT);
    expect(play.session.aircraft.crashCount).toBeGreaterThan(crashes);
    expect(play.session.player.downCount).toBe(0);
    expect(p.phase).toBe('running');
  });

  it('狙いの指標は 9-1 の解析（scripts/replay-analysis）と同じ値', () => {
    for (const drill of PRACTICE_DRILLS) {
      const play = newPlay(7);
      const p = play.startPractice(drill, 2.16);
      const bot = new PracticeBot(play, drill, AVERAGE, 3);
      const a = new ControlAnalyzer(play, { aspect: 2.16 });
      for (let i = 0; i < 60 * 100 && p.phase !== 'finished'; i++) {
        bot.think(DT);
        const running = p.running;
        if (running) a.before({ controls: bot.controls, input: bot.input, assist: false });
        play.step(bot.controls, bot.input, DT);
        if (running) a.after();
      }
      const t = a.finish();
      const f = t.fire;
      const fire = f.inHitCone + f.within2 + f.withinAssist + f.wide + f.outOfRange + f.noTarget;
      expect(p.aim.fireSteps, drill).toBe(fire);
      expect(p.aim.fireInCone, drill).toBe(f.inHitCone);
      expect(p.aim.engagedSteps, drill).toBe(t.engagedSteps);
      expect(p.aim.offScreenSteps, drill).toBe(t.offScreenSteps);
      expect(p.aim.overshoots, drill).toBe(t.crossings);
      expect(p.aim.fireSteps, drill).toBeGreaterThan(0);
    }
  });
});
