// 勲章の拡充（9-10b）: 通算の記録（数え・セーブの確かめ）・補助の段・
// 段階の数えと集めと節目の判定・協力 / PvP の数え・一覧の絞り込みと並べ替え
import { describe, expect, it } from 'vitest';
import { BADGES } from '../src/data/badges';
import { MISSIONS } from '../src/data/missions';
import { assistLevelOf, lowerAssist } from '../src/missions/badges/sortie';
import { earnedTier, recordBadges, syncRecordBadges } from '../src/progression/badges';
import { createInitialSave, parseSave } from '../src/progression/save';
import { addDailyDay, addStats, normalizeStats, statSum } from '../src/progression/stats';
import type { ReplayControls } from '../src/replay/types';
import { matchStats } from '../src/ui/badge-link';
import { badgeRows } from '../src/ui/badge-view';

describe('通算の記録のセーブ', () => {
  it('壊れたキー・負の数・数でない値は捨てる。数え始めの時刻・日替わりの日', () => {
    const s = normalizeStats({
      counts: { kill: 12, 'bad key': 3, 'mv.loop': -1, time: 'x', 'kill.w.gun': 5.5 },
      since: 1000,
      lastDaily: '2026-11-06',
    });
    expect(s).toEqual({
      counts: { kill: 12, 'kill.w.gun': 5.5 },
      since: 1000,
      lastDaily: '2026-11-06',
    });
    expect(normalizeStats(null)).toEqual({ counts: {}, since: 0, lastDaily: null });
    expect(normalizeStats({ lastDaily: 'nope' }).lastDaily).toBeNull();
  });

  it('足す・合計・日替わりは日が変わったときだけ 1 日', () => {
    const s = normalizeStats(null);
    addStats(s, { kill: 2, 'kill.w.gun': 2 }, 5000);
    addStats(s, { kill: 3, zero: 0 }, 9000);
    expect(s.counts).toEqual({ kill: 5, 'kill.w.gun': 2 });
    expect(s.since).toBe(5000);
    expect(statSum(s, ['kill', 'kill.w.gun', 'none'])).toBe(7);
    addDailyDay(s, '2026-11-06');
    addDailyDay(s, '2026-11-06');
    addDailyDay(s, '2026-11-07');
    expect(s.counts['daily.days']).toBe(2);
  });

  it('今のセーブ（v10）を読むと勲章・記録・クレジットはそのままで、通算の記録が空で足される', () => {
    const v10: Record<string, unknown> = {
      ...createInitialSave(),
      version: 10,
      credits: 98765,
      badges: { earned: { loop: [111], campaign: [1, 2] }, backfilled: true },
    };
    delete v10.stats;
    const save = parseSave(JSON.stringify(v10));
    expect(save?.version).toBe(11);
    expect(save?.credits).toBe(98765);
    expect(save?.badges.earned).toEqual({ loop: [111], campaign: [1, 2] });
    expect(save?.stats.counts).toEqual({});
  });
});

describe('補助の段', () => {
  const touch = (o: Partial<ReplayControls>): ReplayControls => ({
    device: 'touch',
    steerMode: 'direct',
    stickCurve: 1,
    stickPosition: 'floating',
    sensitivity: 1,
    deadzone: 0.1,
    aimAssist: 'normal',
    autoFire: false,
    speedMatch: false,
    ...o,
  });
  it('組と同じ 3 段。カスタムも同じ規則・キーボードとパッドは「むずかしい」', () => {
    expect(assistLevelOf(touch({ autoFire: true, speedMatch: true }))).toBe('easy');
    expect(assistLevelOf(touch({ aimAssist: 'strong' }))).toBe('easy');
    expect(assistLevelOf(touch({}))).toBe('normal');
    expect(assistLevelOf(touch({ aimAssist: 'weak' }))).toBe('hard');
    expect(assistLevelOf(touch({ device: 'keyboard', autoFire: true }))).toBe('hard');
    expect(assistLevelOf(touch({ device: 'gamepad' }))).toBe('hard');
    expect(assistLevelOf(null)).toBeNull();
    expect(lowerAssist('hard', 'normal')).toBe('normal');
    expect(lowerAssist('hard', null)).toBeNull();
  });
});

describe('段階の数え・集め・節目', () => {
  it('通算の記録のしきい値で付く（時間・km は換算）・進み具合は次の段', () => {
    const d = createInitialSave();
    d.stats.counts = { kill: 100, time: 3600 * 5.5, dist: 120_000 };
    const got = syncRecordBadges(d, 1);
    const ids = got.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'l.kill.10',
        'l.kill.50',
        'l.kill.100',
        'l.time.1',
        'l.time.5',
        'l.dist.100',
      ]),
    );
    expect(ids).not.toContain('l.kill.250');
    const r = recordBadges(d);
    expect(r['l.kill.250']?.progress).toEqual({ current: 100, goal: 250 });
    expect(r['l.time.10']?.progress).toEqual({ current: 5, goal: 10 });
    expect(r['l.dist.500']?.progress).toEqual({ current: 120, goal: 500 });
  });

  it('集め: 集め以外の 25% で付き、節目は 10 個ごとに 1 回だけ払う', () => {
    const d = createInitialSave();
    const pool = recordBadges(d);
    expect(pool['collect.25']?.tier).toBe(0);
    // 記録から取れる組み合わせを全部取る（キャンペーンのランク・レース・レイド・防衛戦）+ 通算の記録をたくさん
    for (const m of MISSIONS) d.missions[m.id] = { unlocked: true, bestRank: 'S' };
    d.records.raidBestMs = { normal: 1, hard: 1, 'nephirga:normal': 1, 'nephirga:hard': 1 };
    d.records.defenseWaves = {
      'island:normal': 10,
      'island:hard': 10,
      'harbor:normal': 10,
      'harbor:hard': 10,
    };
    for (const k of [
      'kill',
      'kill.w.gun',
      'kill.w.missile',
      'kill.t.fighter',
      'sortie',
      'win',
      'time',
      'dist',
      'mv.loop',
    ])
      d.stats.counts[k] = 1e9;
    const got = syncRecordBadges(d, 1);
    const earned = got.filter((a) => a.milestone === undefined).length;
    expect(earned).toBeGreaterThan(40);
    const milestones = got.filter((a) => a.milestone !== undefined);
    expect(milestones.length).toBe(Math.floor(earned / 10));
    expect(d.badges.milestones).toBe(milestones.length);
    expect(syncRecordBadges(d, 2)).toEqual([]);
    // 集め 25% は 69 個から（この数では付かない）
    expect(earnedTier(d.badges, 'collect.25')).toBe(earned >= 69 ? 1 : 0);
  });
});

describe('協力・PvP の数え', () => {
  it('協力は人数別の遊んだ / クリア、PvP は 2 人以上で遊んだ・勝ち・撃墜', () => {
    expect(
      matchStats({ coop: true, coopClear: true, players: 3, pvpWin: false, kills: 2 }),
    ).toEqual({
      'coop.play.3': 1,
      'coop.clear.3': 1,
    });
    expect(
      matchStats({ coop: false, coopClear: false, players: 4, pvpWin: true, kills: 6 }),
    ).toEqual({
      'pvp.play': 1,
      'pvp.win': 1,
      'pvp.kill': 6,
    });
    expect(
      matchStats({ coop: false, coopClear: false, players: 1, pvpWin: true, kills: 1 }),
    ).toEqual({});
  });
});

describe('一覧の行', () => {
  it('カテゴリ・状態で絞り、隠し勲章は「？？？」・並べ替え', () => {
    const d = createInitialSave();
    d.stats.counts = { 'mv.loop': 20 };
    d.badges.earned = { loop: [500], 'l.mvLoop.10': [900] };
    const flight = badgeRows(d, { group: 'flight', status: 'all', sort: 'default' });
    expect(flight.every((r) => BADGES.find((b) => b.id === r.id)?.group === 'flight')).toBe(true);
    const hidden = flight.find((r) => r.id === 'l.mvLoop.1000');
    expect(hidden?.masked).toBe(true);
    expect(hidden?.title).toBe('？？？');
    const earned = badgeRows(d, { group: 'all', status: 'earned', sort: 'recent' });
    expect(earned.map((r) => r.id)).toEqual(['l.mvLoop.10', 'loop']);
    const progress = badgeRows(d, { group: 'flight', status: 'progress', sort: 'progress' });
    expect(progress[0]?.id).toBe('l.mvLoop.50');
    expect(progress[0]?.progress).toEqual({ current: 20, goal: 50 });
    const none = badgeRows(d, { group: 'career', status: 'none', sort: 'name' });
    expect(none.at(-1)?.masked).toBe(true);
  });
});
