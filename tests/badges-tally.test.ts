// 勲章の拡充（9-10b）: 1 回の飛行のまとめ（モード・武器・種類・難易度・補助の段・組み合わせ）。
// 飛行の結果だけを持つ小さな入れ物で確かめる（実際の世界での記録と再生の一致は badges-replay.test.ts）
import { describe, expect, it } from 'vitest';
import { comboId } from '../src/data/badges-catalog';
import type { GamePlay } from '../src/missions/game-play';
import { SortieWatch } from '../src/missions/badges/sortie';
import { tallySortie } from '../src/missions/badges/tally';
import type { ReplayStart } from '../src/replay/types';
import { BASE_START } from './replay-helpers';

/** まとめの入力だけを持つ飛行の結果 */
function fakePlay(o: {
  outcome?: 'success' | 'failed';
  rank?: string | null;
  damageTaken?: number;
  downs?: number;
  race?: { outcome: 'finished'; rank: string; status: string[] };
  waves?: number;
}): GamePlay {
  const play = {
    runner: o.outcome
      ? { result: { outcome: o.outcome, rank: o.rank ?? null, damageTaken: o.damageTaken ?? 0 } }
      : null,
    race: o.race ? { result: o.race, status: o.race.status } : null,
    defense:
      o.waves !== undefined
        ? { phase: o.waves >= 10 ? 'cleared' : 'failed', wavesCleared: o.waves }
        : null,
    practice: null,
    session: { player: { downCount: o.downs ?? 0 } },
  };
  return play as unknown as GamePlay;
}

function watchWith(kills: Record<string, number>): SortieWatch {
  const w = new SortieWatch();
  w.killCounts = { ...kills };
  w.flightSeconds = 120;
  w.flightMeters = 30000;
  w.maneuvers.counts.loop = 2;
  return w;
}

describe('1 回の飛行のまとめ', () => {
  const mission = (id: string): ReplayStart => ({
    ...BASE_START,
    mode: 'mission',
    missionId: id,
    aircraftId: 'swift',
  });

  it('キャンペーンの成功: 出撃・成功（モード・ミッション・補助・機体）、撃墜の武器・種類、的・部位は戦いの撃墜に入れない', () => {
    const kills = {
      't.fighter': 3,
      'w.gun': 2,
      'wt.gun.fighter': 2,
      'wt.missile.fighter': 1,
      't.ground': 1,
      'wt.bomb.ground': 1,
      't.target': 4,
      't.part': 2,
    };
    const t = tallySortie(
      mission('escort'),
      fakePlay({ outcome: 'success', rank: 'S' }),
      watchWith(kills),
      'hard',
    );
    expect(t.stats).toMatchObject({
      sortie: 1,
      win: 1,
      'sortie.m.mission': 1,
      'win.of.escort': 1,
      'win.a.hard': 1,
      'win.ac.swift': 1,
      kill: 4,
      'kill.w.gun': 2,
      'kill.w.missile': 1,
      'kill.w.bomb': 1,
      'kill.t.fighter': 3,
      'kill.t.ground': 1,
      'kill.t.target': 4,
      'kill.t.part': 2,
      'kill.m.mission': 10,
      time: 120,
      dist: 30000,
      'mv.loop': 2,
      'clear.noHit': 1,
      'clear.noDown': 1,
    });
    expect(t.stats['sortie.d.normal']).toBeUndefined();
    // S は機体と補助の段（むずかしいならふつう以上も）
    expect(t.badges.sort()).toEqual(
      [
        comboId.missionS('escort', 'swift'),
        comboId.missionSAssist('escort', 'normal'),
        comboId.missionSAssist('escort', 'hard'),
      ].sort(),
    );
  });

  it('M1 の被弾なしは数えない・失敗は成功に入れない・補助かんたんの S は補助の組の勲章にならない', () => {
    const t1 = tallySortie(
      mission('training'),
      fakePlay({ outcome: 'success', rank: 'A' }),
      watchWith({}),
      'easy',
    );
    expect(t1.stats['clear.noHit']).toBeUndefined();
    const t2 = tallySortie(
      mission('strike'),
      fakePlay({ outcome: 'failed' }),
      watchWith({}),
      'normal',
    );
    expect(t2.stats.win).toBeUndefined();
    expect(t2.stats.sortie).toBe(1);
    const t3 = tallySortie(
      mission('strike'),
      fakePlay({ outcome: 'success', rank: 'S' }),
      watchWith({}),
      'easy',
    );
    expect(t3.badges).toEqual([comboId.missionS('strike', 'swift')]);
  });

  it('フリーフライトの撃墜はモード別と難易度別だけ（戦いの撃墜の合計に入れない）', () => {
    const start: ReplayStart = {
      ...BASE_START,
      enemies: { enabled: true, difficulty: 'hard', count: 4 },
    };
    const t = tallySortie(
      start,
      fakePlay({}),
      watchWith({ 't.fighter': 5, 'wt.gun.fighter': 5 }),
      'hard',
    );
    expect(t.stats['kill.m.free']).toBe(5);
    expect(t.stats['kill.d.hard']).toBe(5);
    expect(t.stats.kill).toBeUndefined();
    expect(t.stats['kill.w.gun']).toBeUndefined();
    expect(t.stats.win).toBeUndefined();
  });

  it('レイド: 怪獣 × 難易度の無傷・撃墜されず・補助むずかしい（無傷・撃墜されずは補助ふつう以上）', () => {
    const start: ReplayStart = {
      ...BASE_START,
      mode: 'raid',
      raidKaiju: 'nephirga',
      raidDifficulty: 'hard',
    };
    const ok = tallySortie(
      start,
      fakePlay({ outcome: 'success', damageTaken: 0 }),
      watchWith({}),
      'hard',
    );
    expect(ok.badges.sort()).toEqual(
      [
        comboId.raidNoHit('nephirga', 'hard'),
        comboId.raidNoDown('nephirga', 'hard'),
        comboId.raidAssistHard('nephirga', 'hard'),
      ].sort(),
    );
    expect(ok.stats['win.d.hard']).toBe(1);
    expect(ok.stats['win.of.raid-nephirga']).toBe(1);
    const easy = tallySortie(
      start,
      fakePlay({ outcome: 'success', damageTaken: 0 }),
      watchWith({}),
      'easy',
    );
    expect(easy.badges).toEqual([]);
    const hit = tallySortie(
      start,
      fakePlay({ outcome: 'success', damageTaken: 10, downs: 1 }),
      watchWith({}),
      'normal',
    );
    expect(hit.badges).toEqual([]);
  });

  it('レース: くぐったリング・コース × 機体のゴールド（日替わりの周回は除く）', () => {
    const race = {
      outcome: 'finished' as const,
      rank: 'S',
      status: ['passed', 'passed', 'missed', 'passed'],
    };
    const start: ReplayStart = {
      ...BASE_START,
      mode: 'race',
      courseId: 'acro',
      aircraftId: 'vector',
    };
    const t = tallySortie(start, fakePlay({ race }), watchWith({}), null);
    expect(t.stats.ring).toBe(3);
    expect(t.stats['win.m.race']).toBe(1);
    expect(t.stats['sortie.a.normal']).toBeUndefined();
    expect(t.badges).toEqual([comboId.courseGold('acro', 'vector')]);
  });

  it('防衛戦: 守り切った波・難易度', () => {
    const start: ReplayStart = {
      ...BASE_START,
      mode: 'defense',
      mapId: 'harbor',
      defenseDifficulty: 'hard',
    };
    const t = tallySortie(start, fakePlay({ waves: 6 }), watchWith({}), 'normal');
    expect(t.stats.waves).toBe(6);
    expect(t.stats['sortie.d.hard']).toBe(1);
    expect(t.stats.win).toBeUndefined();
  });
});
