// リングレースのゴースト（7-B で入力の記録に移した）: ボットの走行を本番と同じ手順で記録し、別の世界（GhostSim）で
// 再生すると全ステップで同じ位置・姿勢になる。15Hz の位置の記録（90 秒で約 21.6KB）より小さい。セーブの形（base64）で往復する
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-input';
import { COURSES } from '../src/data/courses';
import { decodeGhost, GhostSim } from '../src/missions/race/ghost';
import { encodeReplay, toBase64 } from '../src/replay/codec';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import type { ReplayData, ReplayStart } from '../src/replay/types';
import { RaceBot } from './race-bots';
import { BASE_START, createWorld } from './replay-helpers';

interface Run {
  readonly data: ReplayData;
  readonly positions: number[];
}

/** ボットでゴールまで走り、記録と各ステップの位置を返す */
function recordBotRace(courseIndex: number): Run {
  const course = COURSES[courseIndex];
  if (!course) throw new Error('コースがない');
  const w = createWorld();
  const start: ReplayStart = {
    ...BASE_START,
    mode: 'race',
    mapId: course.mapId,
    courseId: course.id,
    upgrades: { engine: 0, airframe: 0, weapons: 0, avionics: 0 },
  };
  startFromHeader(w, start);
  const race = w.play.race;
  if (!race) throw new Error('レースが始まらない');
  const rec = new ReplayRecorder();
  rec.begin(start, {
    title: course.name,
    pilotName: 'bot',
    date: '2026-10-31T00:00:00Z',
    gameVersion: '1.0.0',
    startHash: simHash(w),
  });
  const bot = new RaceBot({ play: w.play, race, map: w.map });
  const input = createCombatInput();
  const positions: number[] = [];
  const limit = (course.timeLimitSeconds + 10) * 60;
  for (let i = 0; i < limit && race.phase !== 'finished'; i++) {
    const f = captureFrame(rec.frame, bot.think(), input, w.play.session);
    applyFrame(f, w.controls, input, w.play.session);
    rec.push(f);
    stepWorld(w.play, w.buildings(), w.controls, input, 1 / 60);
    const p = w.play.session.aircraft.state.position;
    positions.push(p.x, p.y, p.z);
  }
  expect(race.result?.outcome).toBe('finished');
  const data = rec.finish(null);
  if (!data) throw new Error('記録がない');
  return { data, positions };
}

describe('レースのゴースト（入力の記録）', () => {
  for (const index of [0, 2]) {
    it(`${COURSES[index]?.name ?? ''}: ゴーストは全ステップでボットと同じ位置（別の世界で再生）`, () => {
      const run = recordBotRace(index);
      const w2 = createWorld();
      w2.map.use(run.data.header.mapId);
      const ghost = new GhostSim(w2.map.ground, () => w2.map.buildings);
      const enc = toBase64(encodeReplay(run.data));
      const data = decodeGhost(enc, run.data.header.courseId ?? '');
      expect(data).not.toBeNull();
      ghost.start(data);
      let worst = 0;
      for (let i = 0; i < run.data.header.steps; i++) {
        ghost.step();
        const p = ghost.play.session.aircraft.state.position;
        worst = Math.max(
          worst,
          Math.abs(p.x - (run.positions[i * 3] ?? 0)),
          Math.abs(p.y - (run.positions[i * 3 + 1] ?? 0)),
          Math.abs(p.z - (run.positions[i * 3 + 2] ?? 0)),
        );
      }
      expect(worst).toBe(0);
      // 描画用の補間（レース中だけ出す）
      const q = { x: 0, y: 0, z: 0, w: 1 };
      const pos = { x: 0, y: 0, z: 0 };
      expect(typeof ghost.sample(0.5, pos, q)).toBe('boolean');
      // 容量: 15Hz の位置の記録（1 秒 180 バイト → base64 240 バイト）より小さい
      const seconds = run.data.header.steps / 60;
      expect(enc.length).toBeLessThan(seconds * 240);
      expect(encodeReplay(run.data).length / (seconds / 60)).toBeLessThan(10 * 1024);
    }, 60_000);
  }

  it('違うコース・壊れたデータは読まない', () => {
    expect(decodeGhost('AAAA', 'coast')).toBeNull();
    expect(decodeGhost('not base64!!', 'coast')).toBeNull();
  });
});
