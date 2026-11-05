// 9-8 リングレースの道案内（src/missions/race/guide.ts・preview.ts・path.ts）と、下見を見た印・点線の設定のセーブ
import { describe, expect, it } from 'vitest';
import './i18n-setup';
import { COURSES, findCourse } from '../src/data/courses';
import { RACE_GUIDE } from '../src/data/race';
import { buildRaceRings } from '../src/missions/race/course';
import { missedRing, ringCues } from '../src/missions/race/guide';
import { coursePath, sampleLeg } from '../src/missions/race/path';
import { CoursePreview } from '../src/missions/race/preview';
import { markPreviewed, raceRecord } from '../src/progression/race-records';
import { normalizeRaces } from '../src/progression/save-races';
import { defaultSettings, normalizeSettings } from '../src/progression/save-settings';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';

class MemoryStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function course(id: string) {
  const c = findCourse(id);
  if (!c) throw new Error(id);
  return c;
}

describe('普通に飛ぶと通れないリングの印', () => {
  it('夕空アクロバット: 宙返り・インメルマン・スプリット S・真下のリングに印（番号は 1 始まりの 3〜13）', () => {
    const c = course('acro');
    const cues = ringCues(c, buildRaceRings(c));
    const marked = cues.map((q, i) => (q ? `${i + 1}:${q}` : '')).filter(Boolean);
    expect(marked).toEqual([
      '3:up',
      '4:loop',
      '5:down',
      '6:pull',
      '8:up',
      '9:loop',
      '12:down',
      '13:pull',
    ]);
  });

  it('ほかの 5 コース（水平の周回・スラローム・らせん）には印がない', () => {
    for (const c of COURSES.filter((x) => x.id !== 'acro'))
      expect(
        ringCues(c, buildRaceRings(c)).every((q) => q === null),
        c.id,
      ).toBe(true);
  });
});

describe('通り損ね', () => {
  const ring = { position: { x: 0, y: 100, z: 0 } };
  const north = { x: 0, y: 0, z: -300 };
  it('進む向きから 100° より後ろ・60m より遠いと出し、70° 内に戻るまで出したまま', () => {
    // リングの北 500m を北へ飛ぶ（リングは真後ろ）
    expect(missedRing(ring, { x: 0, y: 100, z: -500 }, north, false)).toBe(true);
    // 前にある
    expect(missedRing(ring, { x: 0, y: 100, z: 500 }, north, false)).toBe(false);
    // すぐ近く（通り抜けの途中）は出さない
    expect(missedRing(ring, { x: 0, y: 100, z: -30 }, north, false)).toBe(false);
    // 横（90°）: 出していなければ出さない、出していれば戻るまで出したまま
    const side = { x: 500, y: 100, z: 0 };
    expect(missedRing(ring, side, north, false)).toBe(false);
    expect(missedRing(ring, side, north, true)).toBe(true);
    // 向き直した（リングが 60° 内）
    const back = { x: -260, y: 0, z: 150 };
    expect(missedRing(ring, side, back, true)).toBe(false);
  });

  it('今の決まりは変えない: 印は判定（RaceRunner）に触らない（数値は RACE_GUIDE だけ）', () => {
    expect(RACE_GUIDE.missAngleDeg).toBeGreaterThan(RACE_GUIDE.clearAngleDeg);
  });
});

describe('道筋（ボット・点線・下見で同じ線）', () => {
  it('区間の点は開始位置（または前のリング）とリングの間の曲線の上にあり、リングの近くで向きが法線に沿う', () => {
    const c = course('coast');
    const rings = buildRaceRings(c);
    const out = Array.from({ length: 200 }, () => ({ x: 0, y: 0, z: 0 }));
    const n = sampleLeg(c, rings, 1, RACE_GUIDE.dotSpacing, out, 0, out.length);
    expect(n).toBeGreaterThan(10);
    const a = rings[0];
    const b = rings[1];
    if (!a || !b) throw new Error('rings');
    const first = out[0];
    const last = out[n - 1];
    if (!first || !last) throw new Error('points');
    expect(Math.hypot(first.x - a.position.x, first.z - a.position.z)).toBeLessThan(60);
    expect(Math.hypot(last.x - b.position.x, last.z - b.position.z)).toBeLessThan(60);
    // 上限で止める
    expect(sampleLeg(c, rings, 1, 1, out, 190, 200)).toBe(10);
    // ボットの道筋と同じ曲線（リングの点が一致）
    const index: number[] = [];
    const path = coursePath(c, rings, index);
    const at = path[index[1] ?? -1];
    expect(at?.x).toBeCloseTo(b.position.x);
    expect(at?.z).toBeCloseTo(b.position.z);
  });
});

describe('コースの下見', () => {
  it('10〜20 秒・開始位置の後ろから始まりゴールへ進む・距離は時間に沿って増える', () => {
    for (const c of COURSES) {
      const pv = new CoursePreview(c, buildRaceRings(c));
      expect(pv.duration, c.id).toBeGreaterThanOrEqual(RACE_GUIDE.preview.minSeconds);
      expect(pv.duration, c.id).toBeLessThanOrEqual(RACE_GUIDE.preview.maxSeconds);
      const eye = { x: 0, y: 0, z: 0 };
      const look = { x: 0, y: 0, z: 0 };
      pv.pose(eye, look);
      expect(eye.y, c.id).toBeGreaterThan(c.start.y);
      expect(pv.done).toBe(false);
      const goal = c.rings.at(-1);
      if (!goal) throw new Error('goal');
      let lastDist = Infinity;
      let closer = 0;
      for (let k = 0; k < 20; k++) {
        pv.advance(pv.duration / 20);
        pv.pose(eye, look);
        const d = Math.hypot(look.x - goal.x, look.y - goal.y, look.z - goal.z);
        if (d <= lastDist + 1) closer++;
        lastDist = d;
      }
      expect(pv.done).toBe(true);
      // 見る点は最後にはゴールの近く
      expect(lastDist, c.id).toBeLessThan(RACE_GUIDE.preview.lookAhead + 50);
      expect(closer, c.id).toBeGreaterThan(0);
    }
  });
});

describe('セーブ: 下見を見た印・点線の設定（版は上げない）', () => {
  it('下見を見たコースに previewed。ない項目は見ていない扱い・壊れた値は捨てる', () => {
    const storage = new MemoryStorage();
    const save = SaveStore.open(storage).store;
    expect(raceRecord(save, 'acro').previewed).toBeUndefined();
    markPreviewed(save, 'acro');
    expect(raceRecord(save, 'acro').previewed).toBe(true);
    expect(raceRecord(save, 'coast').previewed).toBeUndefined();
    // 保存されて、開き直しても残る
    expect(raceRecord(SaveStore.open(storage).store, 'acro').previewed).toBe(true);
    const races = normalizeRaces({
      acro: { bestRank: null, clears: 0, times: [], ghost: null, previewed: true },
      coast: { bestRank: null, clears: 0, times: [], ghost: null, previewed: 'yes' },
    });
    expect(races.acro?.previewed).toBe(true);
    expect(races.coast).toEqual({ bestRank: null, clears: 0, times: [], ghost: null });
  });

  it('道筋の点線は初期値 ON（設定で OFF。ない項目は初期値）', () => {
    expect(defaultSettings().raceGuideLine).toBe(true);
    expect(normalizeSettings({}).raceGuideLine).toBe(true);
    expect(normalizeSettings({ raceGuideLine: false }).raceGuideLine).toBe(false);
  });
});
