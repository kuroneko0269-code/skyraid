// リングレース（7-1）の流れ: 画面の遷移、GamePlay のレース（カウントダウン中は止めてスロットル全開・武器なし・
// ブーストで無料のアフターバーナー・墜落は最後のリングへ・中断で捨てる）
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { canTransition, GameState } from '../src/core/game-state';
import { COURSES } from '../src/data/courses';
import { RACE_CONFIG } from '../src/data/race';
import type { AircraftControls } from '../src/entities/aircraft';
import { DT, startRaceSim } from './race-bots';

const IDLE: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };

describe('リングレースの画面の遷移', () => {
  it('モード選択 → コース一覧 → 飛行 → リザルト → コース一覧。ポーズの「中断」もコース一覧へ', () => {
    const game = new GameState();
    const path = [
      'title',
      'mode_select',
      'race_select',
      'flight',
      'result',
      'race_select',
    ] as const;
    for (const to of path) expect(game.transition(to), to).toBe(true);
    for (const to of ['flight', 'pause', 'race_select', 'mode_select'] as const)
      expect(game.transition(to), to).toBe(true);
    expect(canTransition('race_select', 'hangar')).toBe(false);
  });
});

describe('GamePlay のレース', () => {
  const course = COURSES[0];
  if (!course) throw new Error('コースがない');

  it('カウントダウン中はスタート地点に止め、スロットル全開。GO の後に動き出す', () => {
    const { play, race } = startRaceSim(course);
    const a = play.session.aircraft;
    for (let i = 0; i < 120; i++) play.step(IDLE, createCombatInput(), DT);
    expect(race.phase).toBe('countdown');
    expect(a.state.position).toEqual({ x: course.start.x, y: course.start.y, z: course.start.z });
    expect(a.throttle).toBe(1);
    for (let i = 0; i < 61; i++) play.step(IDLE, createCombatInput(), DT);
    expect(race.phase).toBe('racing');
    for (let i = 0; i < 60; i++) play.step(IDLE, createCombatInput(), DT);
    expect(
      Math.hypot(a.state.position.x - course.start.x, a.state.position.z - course.start.z),
    ).toBeGreaterThan(200);
  });

  it('レース中は武器を使えない（引き金を引いても撃たない）', () => {
    const { play } = startRaceSim(course);
    const input = createCombatInput();
    input.trigger = true;
    input.missile = true;
    const missiles = play.session.combat.missileAmmo.count;
    for (let i = 0; i < 300; i++) play.step(IDLE, input, DT);
    expect(play.session.combat.gun.bullets.count).toBe(0);
    expect(play.session.combat.missileAmmo.count).toBe(missiles);
  });

  it('ブーストリングを通るとゲージを使わずに 3 秒アフターバーナー', () => {
    const { play, race } = startRaceSim(course);
    const boost = race.rings.find((r) => r.kind === 'boost');
    if (!boost) throw new Error('ブーストがない');
    race.bus.emit('race:ring', { ring: boost, time: 0 });
    const f = play.session.aircraft.flight;
    expect(f.freeAfterburnerSeconds).toBe(RACE_CONFIG.boostSeconds);
    // 3 秒の間は押さなくても効き、ゲージは減らない
    for (let i = 0; i < 179; i++) play.session.aircraft.step(IDLE, DT);
    expect(f.state.afterburnerGauge).toBe(1);
    expect(f.state.afterburnerActive).toBe(true);
    for (let i = 0; i < 3; i++) play.session.aircraft.step(IDLE, DT);
    expect(f.state.afterburnerActive).toBe(false);
  });

  it('墜落したら最後に通ったリング（まだなければスタート地点）へ戻る。時計は止めない', () => {
    const { play, race } = startRaceSim(course);
    for (let i = 0; i < 181; i++) play.step(IDLE, createCombatInput(), DT);
    expect(race.phase).toBe('racing');
    // 海へ向けて急降下させる
    const dive: AircraftControls = { ...IDLE, pitch: -1 };
    const seen = { respawns: 0 };
    play.session.onRespawn(() => {
      seen.respawns++;
    });
    for (let i = 0; i < 600 && seen.respawns === 0; i++) play.step(dive, createCombatInput(), DT);
    expect(seen.respawns).toBe(1);
    const p = play.session.aircraft.state.position;
    expect([p.x, p.y, p.z]).toEqual([course.start.x, course.start.y, course.start.z]);
    expect(play.session.player.active).toBe(true);
    expect(race.elapsed).toBeGreaterThan(0.5);
  });

  it('中断（ポーズの「レースを中断」）でレースを捨てる', () => {
    const { play } = startRaceSim(course);
    const seen: unknown[] = [];
    play.onRaceChange((r) => seen.push(r));
    play.abortMission();
    expect(play.race).toBeNull();
    expect(seen).toEqual([null]);
  });
});
