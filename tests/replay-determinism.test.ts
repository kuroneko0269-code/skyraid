// リプレイ（7-B）の決定性: 本番と同じ手順で記録した飛行を、別の世界で 2 回再生すると、全ステップの状態ハッシュが
// 記録したときと一致する（各モード）。前に別の飛行をした世界で記録しても同じ（飛行の始めに起動直後の状態へ戻す）
import { describe, expect, it } from 'vitest';
import type { ReplayStart } from '../src/replay/types';
import { BASE_START, createWorld, record, replay } from './replay-helpers';

const MODES: readonly [string, ReplayStart, boolean][] = [
  ['フリーフライト（島・敵 2 機）', BASE_START, false],
  ['キャンペーン（M3 護衛）', { ...BASE_START, mode: 'mission', missionId: 'escort' }, false],
  ['キャンペーン（M4 破壊）', { ...BASE_START, mode: 'mission', missionId: 'strike' }, false],
  [
    'ソロレイド（港湾都市）',
    { ...BASE_START, mode: 'raid', mapId: 'harbor', raidDifficulty: 'normal' },
    false,
  ],
  [
    'リングレース（港湾ハイスピード）',
    { ...BASE_START, mode: 'race', mapId: 'harbor', courseId: 'harbor-speed' },
    false,
  ],
  [
    'ソロ防衛戦（島。準備はすぐスキップ）',
    { ...BASE_START, mode: 'defense', mapId: 'island', defenseDifficulty: 'normal' },
    true,
  ],
];

const firstMismatch = (a: readonly string[], b: readonly string[]): number => {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  return a.findIndex((h, i) => h !== b[i]);
};

describe('同じ記録を 2 回再生すると全ステップの状態ハッシュが一致する', () => {
  for (const [name, start, autoSkip] of MODES) {
    it(
      name,
      () => {
        // 前に別のモードを飛んだ世界で記録する（名残があっても同じ始まりになる）
        const w = createWorld();
        record(
          w,
          { ...BASE_START, mode: 'raid', mapId: 'harbor', raidDifficulty: 'hard', seed: 5 },
          { seconds: 3 },
        );
        const rec = record(w, start, { seconds: 12, hashes: true, autoSkip, pilotSeed: 11 });
        expect(rec.hashes).toHaveLength(12 * 60);
        const a = replay(createWorld(), rec.data);
        const b = replay(createWorld(), rec.data);
        expect(a.player.startMatches).toBe(true);
        expect(firstMismatch(rec.hashes, a.hashes)).toBe(-1);
        expect(firstMismatch(a.hashes, b.hashes)).toBe(-1);
      },
      120_000,
    );
  }

  it('長い飛行（防衛戦 4 分）も最後まで一致する（10 秒ごとのハッシュ）', () => {
    const start: ReplayStart = {
      ...BASE_START,
      mode: 'defense',
      mapId: 'harbor',
      defenseDifficulty: 'hard',
      seed: 77,
    };
    const rec = record(createWorld(), start, { seconds: 240, autoSkip: true, pilotSeed: 4 });
    const a = replay(createWorld(), rec.data, 600);
    const b = replay(createWorld(), rec.data, 600);
    expect(a.hashes).toHaveLength(24);
    expect(a.hashes).toEqual(b.hashes);
  }, 180_000);

  it('外部の操作（対象の選択・敵の設定の変更）も同じステップに効く', () => {
    const rec = record(createWorld(), BASE_START, {
      seconds: 10,
      hashes: true,
      commands: [
        { step: 120, kind: 'select', target: 3 },
        { step: 240, kind: 'enemies', enabled: true, difficulty: 'hard', count: 3 },
        { step: 400, kind: 'select', target: -1 },
        { step: 480, kind: 'enemies', enabled: false, difficulty: 'easy', count: 1 },
      ],
    });
    expect(rec.data.commands).toHaveLength(4);
    const a = replay(createWorld(), rec.data);
    expect(firstMismatch(rec.hashes, a.hashes)).toBe(-1);
    // 違うシードでは違う飛行になる（ハッシュが乱数を見ている）
    const other = record(
      createWorld(),
      { ...BASE_START, seed: 999 },
      { seconds: 10, hashes: true },
    );
    expect(other.hashes[599]).not.toBe(rec.hashes[599]);
  }, 120_000);
});
