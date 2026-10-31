// リングレース（7-1）: ペナルティ（未通過 +5 秒・戻らなくて良い・チェックポイントは飛ばせない）・細いリングのボーナス・
// ランク（ゴールドタイム以下 S・×1.15 A・×1.3 B・完走 C）・報酬（初クリア・ランク更新の差額・以降 300 CR）
import { describe, expect, it } from 'vitest';
import { RACE_CONFIG } from '../src/data/race';
import type { RaceWorld } from '../src/missions/race/runner';
import { RaceRunner } from '../src/missions/race/runner';
import {
  formatDelta,
  formatRaceTime,
  raceRank,
  raceReward,
  raceTime,
} from '../src/missions/race/score';
import type { CourseDef, CourseRingDef, RingKind } from '../src/missions/race/types';

const DT = 1 / 60;

/** 北（−Z）へ 1000m おきに並んだリング（高度 500m、向きは北） */
function course(kinds: RingKind[], gold = 60): CourseDef {
  const rings: CourseRingDef[] = kinds.map((kind, i) => ({
    x: 0,
    y: 500,
    z: -1000 * (i + 1),
    headingDeg: 0,
    pitchDeg: 0,
    kind,
  }));
  return {
    id: 'test',
    name: 'テスト',
    note: '',
    level: '',
    mapId: 'island',
    weatherId: 'day-clear',
    start: { x: 0, y: 500, z: 0, headingDeg: 0 },
    rings,
    timeLimitSeconds: 300,
    goldTimeSeconds: gold,
  };
}

/** 手で動かす自機 */
class World implements RaceWorld {
  readonly playerPosition = { x: 0, y: 500, z: 0 };
  readonly playerPrevPosition = { x: 0, y: 500, z: 0 };
  readonly playerOrientation = { x: 0, y: 0, z: 0, w: 1 };
  playerActive = true;
  moveTo(x: number, z: number): void {
    this.playerPrevPosition.x = this.playerPosition.x;
    this.playerPrevPosition.z = this.playerPosition.z;
    this.playerPosition.x = x;
    this.playerPosition.z = z;
  }
}

/** カウントダウンを終わらせる */
function go(race: RaceRunner, world: World): void {
  for (let i = 0; i < 200 && race.phase === 'countdown'; i++) race.step(DT, world);
}

/** 1 ステップで (x, z) まで動いて時計を dt 進める */
function fly(race: RaceRunner, world: World, x: number, z: number, dt = DT): void {
  world.moveTo(x, z);
  race.step(dt, world);
}

describe('タイムとペナルティ', () => {
  it('タイム = 時計 + 未通過 × 5 − 細い × 2（0 未満にしない・1/1000 秒に丸める）', () => {
    expect(raceTime(60, 0, 0)).toBe(60);
    expect(raceTime(60, 2, 0)).toBe(70);
    expect(raceTime(60, 0, 3)).toBe(54);
    expect(raceTime(60.12345, 1, 1)).toBe(63.123);
    expect(raceTime(1, 0, 3)).toBe(0);
  });

  it('カウントダウン 3・2・1 → GO。その間は時計が進まない', () => {
    const race = new RaceRunner(course(['normal', 'checkpoint']));
    const world = new World();
    const counts: number[] = [];
    let started = 0;
    race.bus.on('race:countdown', ({ count }) => counts.push(count));
    race.bus.on('race:start', () => started++);
    for (let i = 0; i < 179; i++) race.step(DT, world);
    expect(race.phase).toBe('countdown');
    expect(race.elapsed).toBe(0);
    race.step(DT, world);
    race.step(DT, world);
    expect(race.phase).toBe('racing');
    expect(counts).toEqual([3, 2, 1]);
    expect(started).toBe(1);
  });

  it('リングを飛ばして先のリングを通ると、飛ばしたリングは +5 秒（戻らなくて良い）', () => {
    const race = new RaceRunner(course(['normal', 'normal', 'normal', 'checkpoint']));
    const world = new World();
    const missed: number[] = [];
    race.bus.on('race:miss', ({ rings }) => missed.push(...rings.map((r) => r.index)));
    go(race, world);
    // 1 個目の横（輪の外）を抜け、2 個目は真ん中を通る
    fly(race, world, 200, -900);
    fly(race, world, 200, -1100, 9);
    expect(race.next).toBe(0);
    fly(race, world, 0, -1900);
    fly(race, world, 0, -2100, 1);
    expect(race.status).toEqual(['missed', 'passed', 'pending', 'pending']);
    expect(missed).toEqual([0]);
    expect(race.next).toBe(2);
    fly(race, world, 0, -2900);
    fly(race, world, 0, -3100);
    fly(race, world, 0, -3900);
    fly(race, world, 0, -4100);
    const result = race.result;
    expect(result?.outcome).toBe('finished');
    expect(result?.missed).toBe(1);
    expect(result?.penaltySeconds).toBe(RACE_CONFIG.missPenaltySeconds);
    expect(result?.time).toBeCloseTo((result?.rawSeconds ?? 0) + 5, 3);
  });

  it('チェックポイントは飛ばせない: 通るまで先のリングを通っても数えない', () => {
    const race = new RaceRunner(course(['normal', 'checkpoint', 'normal', 'checkpoint']));
    const world = new World();
    go(race, world);
    fly(race, world, 0, -900);
    fly(race, world, 0, -1100);
    // チェックポイント（2 個目）の外を抜けて 3 個目を通る → 数えない
    fly(race, world, 300, -1900);
    fly(race, world, 300, -2100);
    fly(race, world, 0, -2900);
    fly(race, world, 0, -3100);
    expect(race.next).toBe(1);
    expect(race.status).toEqual(['passed', 'pending', 'pending', 'pending']);
    // 戻ってチェックポイントを通る
    fly(race, world, 0, -2100);
    fly(race, world, 0, -1900);
    expect(race.status[1]).toBe('passed');
    expect(race.next).toBe(2);
  });

  it('細いリングは −2 秒、ブーストは通過のイベント。スプリットは比べる走行との差', () => {
    const ref = { ringTimes: [1, 2, 3] };
    const race = new RaceRunner(course(['thin', 'boost', 'checkpoint']), ref);
    const world = new World();
    const kinds: string[] = [];
    const splits: (number | null)[] = [];
    race.bus.on('race:ring', ({ ring }) => kinds.push(ring.kind));
    race.bus.on('race:split', ({ delta }) => splits.push(delta));
    go(race, world);
    fly(race, world, 0, -900, 1);
    fly(race, world, 10, -1100, 1);
    expect(race.thinPassed).toBe(1);
    // 2 秒走って −2 秒 → タイム 0。比べる走行は 1 秒 → 差 −1
    expect(race.currentTime).toBeCloseTo(0);
    expect(race.ghostDelta).toBeCloseTo(-1);
    fly(race, world, 0, -2100, 1);
    fly(race, world, 0, -3100, 1);
    expect(kinds).toEqual(['thin', 'boost', 'checkpoint']);
    expect(splits).toHaveLength(1);
    expect(splits[0]).toBeCloseTo(2 - 3);
    expect(race.result?.bonusSeconds).toBe(2);
    expect(race.result?.ringTimes).toHaveLength(3);
  });

  it('細いリングは半径半分: 通常なら通る位置（中心から 30m）でも通らない', () => {
    const race = new RaceRunner(course(['thin', 'checkpoint']));
    const world = new World();
    go(race, world);
    fly(race, world, 30, -900);
    fly(race, world, 30, -1100);
    expect(race.status[0]).toBe('pending');
    const normal = new RaceRunner(course(['normal', 'checkpoint']));
    const w2 = new World();
    go(normal, w2);
    fly(normal, w2, 30, -900);
    fly(normal, w2, 30, -1100);
    expect(normal.status[0]).toBe('passed');
  });

  it('制限時間を過ぎると時間切れ（ランク・報酬なし）', () => {
    const c = { ...course(['normal', 'checkpoint']), timeLimitSeconds: 5 };
    const race = new RaceRunner(c);
    const world = new World();
    go(race, world);
    for (let i = 0; i < 6 / DT && race.phase === 'racing'; i++) race.step(DT, world);
    expect(race.result?.outcome).toBe('timeout');
    expect(race.result?.rank).toBeNull();
    expect(race.readyForResult).toBe(false);
    for (let i = 0; i < RACE_CONFIG.finishBannerSeconds / DT + 1; i++) race.step(DT, world);
    expect(race.readyForResult).toBe(true);
  });

  it('墜落後の戻り先: 最後に通ったリング（まだなければ開始位置）から次のリングの方へ', () => {
    const race = new RaceRunner(course(['normal', 'normal', 'checkpoint']));
    const world = new World();
    go(race, world);
    expect(race.respawnPose()).toEqual({ x: 0, y: 500, z: 0, headingDeg: 0 });
    fly(race, world, 0, -900);
    fly(race, world, 0, -1100);
    const p = race.respawnPose();
    expect([p.x, p.y, p.z]).toEqual([0, 500, -1000]);
    expect(p.headingDeg).toBeCloseTo(0);
  });
});

describe('ランクと報酬', () => {
  it('ゴールドタイム以下 S、×1.15 以下 A、×1.3 以下 B、それ以外の完走は C', () => {
    expect(raceRank(60, 60)).toBe('S');
    expect(raceRank(60.001, 60)).toBe('A');
    expect(raceRank(69, 60)).toBe('A');
    expect(raceRank(69.01, 60)).toBe('B');
    expect(raceRank(78, 60)).toBe('B');
    expect(raceRank(78.01, 60)).toBe('C');
    expect(raceRank(500, 60)).toBe('C');
  });

  it('初クリア 1500 CR（C の額）、ランク更新で差額、以降は 300 CR', () => {
    expect(raceReward('C', null)).toBe(1500);
    expect(raceReward('S', null)).toBe(3000);
    expect(raceReward('B', 'C')).toBe(500);
    expect(raceReward('S', 'B')).toBe(1000);
    expect(raceReward('A', 'A')).toBe(300);
    expect(raceReward('C', 'S')).toBe(300);
  });

  it('表示: 「1:02.345」「42.000」、差「+1.23」「−0.45」「±0.00」', () => {
    expect(formatRaceTime(62.345)).toBe('1:02.345');
    expect(formatRaceTime(42)).toBe('42.000');
    expect(formatRaceTime(9.5)).toBe('9.500');
    expect(formatDelta(1.234)).toBe('+1.23');
    expect(formatDelta(-0.451)).toBe('−0.45');
    expect(formatDelta(0.001)).toBe('±0.00');
  });
});
