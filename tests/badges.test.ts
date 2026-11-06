// 勲章（9-10）: 記録からの判定と
// さかのぼり（v9 のセーブから）・入れ方（1 回だけ・報酬・段階）・読み込みの確かめ・補助の組の判定・協力 / PvP の集計
import { describe, expect, it } from 'vitest';
import {
  BADGE_CONFIG,
  BADGES,
  badgeCondition,
  badgeName,
  badgeTiers,
  findBadge,
  LEGACY_BADGE_IDS,
} from '../src/data/badges';
import { BADGE_REWARDS } from '../src/data/badges-catalog';
import { useLocale } from './i18n-helpers';
import { COURSES } from '../src/data/courses';
import { MISSIONS } from '../src/data/missions';
import { TUTORIAL_CHAPTERS } from '../src/data/tutorial';
import { assistQualifies, judgeMatch } from '../src/missions/badges/sortie';
import {
  awardBadges,
  badgeTotals,
  earnedTier,
  normalizeBadges,
  recordBadges,
  syncRecordBadges,
  totalBadgeRewards,
} from '../src/progression/badges';
import { createInitialSave, parseSave, SAVE_MIGRATIONS } from '../src/progression/save';
import { emptyRaceRecord } from '../src/progression/save-races';
import type { ReplayControls } from '../src/replay/types';

describe('補助の組の判定（補助ふつう以上）', () => {
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
  it('ふつう・むずかしいは可、かんたん（自動射撃・速度合わせ）・狙いの補助「強」は不可。キーボード・パッドは可', () => {
    expect(assistQualifies(touch({}))).toBe(true);
    expect(assistQualifies(touch({ aimAssist: 'weak' }))).toBe(true);
    expect(assistQualifies(touch({ autoFire: true, speedMatch: true }))).toBe(false);
    expect(assistQualifies(touch({ autoFire: true }))).toBe(false);
    expect(assistQualifies(touch({ speedMatch: true }))).toBe(false);
    expect(assistQualifies(touch({ aimAssist: 'strong' }))).toBe(false);
    expect(assistQualifies(touch({ device: 'keyboard', autoFire: true }))).toBe(true);
    expect(assistQualifies(touch({ device: 'gamepad' }))).toBe(true);
    // 設定の無い古い記録は数えない
    expect(assistQualifies(null)).toBe(false);
  });
});

describe('協力・PvP の集計', () => {
  it('協力のクリア・4 人で・PvP の勝ち（1 人では数えない）', () => {
    expect(
      judgeMatch({ coop: true, coopClear: true, players: 2, pvpWin: false, kills: 0 }),
    ).toEqual(['coopClear']);
    expect(
      judgeMatch({ coop: true, coopClear: true, players: 4, pvpWin: false, kills: 0 }),
    ).toEqual(['coopClear', 'coopFour']);
    expect(
      judgeMatch({ coop: true, coopClear: false, players: 4, pvpWin: false, kills: 0 }),
    ).toEqual([]);
    expect(
      judgeMatch({ coop: false, coopClear: false, players: 3, pvpWin: true, kills: 0 }),
    ).toEqual(['pvpWin']);
    expect(
      judgeMatch({ coop: false, coopClear: false, players: 1, pvpWin: true, kills: 0 }),
    ).toEqual([]);
  });
});

describe('勲章の定義', () => {
  it('9-10b: 150〜300 個・id は重ならない・段階は 1 か 3・報酬は正', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(150);
    expect(BADGES.length).toBeLessThanOrEqual(300);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    for (const b of BADGES) {
      expect([1, 3]).toContain(badgeTiers(b));
      for (const r of b.rewards) expect(r).toBeGreaterThan(0);
    }
  });

  it('9-10 の 28 個は id・報酬がそのまま（合計 46,500 CR）で先頭に並ぶ', () => {
    expect(LEGACY_BADGE_IDS.length).toBe(28);
    expect(BADGES.slice(0, 28).map((b) => b.id)).toEqual(LEGACY_BADGE_IDS);
    const legacy = BADGES.filter((b) => LEGACY_BADGE_IDS.includes(b.id));
    expect(totalBadgeRewards(legacy)).toBe(46500);
  });

  it('9-10b の報酬: 1 つ 100 CR・集め 4 つで 15,000 CR・節目は 10 個ごとに 500 CR（合計が増えすぎない）', () => {
    const extra = BADGES.filter((b) => !LEGACY_BADGE_IDS.includes(b.id));
    const collect = extra.filter((b) => b.collect !== undefined);
    expect(collect.map((b) => b.rewards[0])).toEqual([1000, 2000, 4000, 8000]);
    for (const b of extra)
      if (b.collect === undefined) expect(b.rewards).toEqual([BADGE_REWARDS.each]);
    const milestones =
      Math.floor(BADGES.length / BADGE_REWARDS.milestoneEvery) * BADGE_REWARDS.milestone;
    // 9-10 の 46,500 と合わせて 10 万 CR 以内（使い道の合計 316,000 CR の 3 分の 1 以下。docs/control-analysis.md）
    expect(totalBadgeRewards() + milestones).toBeLessThanOrEqual(100_000);
  });

  it('名前と条件の文が日本語・英語ともにある（キーのまま出ない）', () => {
    for (const lang of ['ja', 'en'] as const) {
      useLocale(lang);
      for (const b of BADGES) {
        const name = badgeName(b.id);
        const cond = badgeCondition(b.id);
        expect(name).not.toContain('badges.');
        expect(cond).not.toContain('badges.');
        expect(name).not.toMatch(/[{}]/);
        expect(cond).not.toMatch(/[{}]/);
      }
    }
    useLocale('ja');
  });

  it('隠し勲章は 1 割前後（取るまで「？？？」）', () => {
    const hidden = BADGES.filter((b) => b.hidden).length;
    expect(hidden).toBeGreaterThanOrEqual(10);
    expect(hidden).toBeLessThanOrEqual(BADGES.length * 0.15);
  });
});

describe('入れ方とセーブ', () => {
  it('1 回だけ・報酬を足す・段階付きは下の段階もまとめて', () => {
    const d = createInitialSave();
    d.credits = 100;
    const a = awardBadges(d, [{ id: 'loop', tier: 1 }], 1000);
    expect(a).toEqual([{ id: 'loop', tier: 1, credits: 300 }]);
    expect(d.credits).toBe(400);
    expect(awardBadges(d, [{ id: 'loop', tier: 1 }], 2000)).toEqual([]);
    expect(d.credits).toBe(400);
    const c = awardBadges(d, [{ id: 'campaign', tier: 2 }], 3000);
    expect(c.map((x) => x.tier)).toEqual([1, 2]);
    expect(d.badges.earned.campaign).toEqual([3000, 3000]);
    expect(d.credits).toBe(400 + 1000 + 2000);
    // 知らない id・段階を超える数は無視・切り詰め
    expect(
      awardBadges(
        d,
        [
          { id: 'nope', tier: 1 },
          { id: 'ace', tier: 5 },
        ],
        4000,
      ),
    ).toEqual([{ id: 'ace', tier: 1, credits: 1000 }]);
    expect(badgeTotals(d.badges)).toMatchObject({ earned: 3, total: BADGES.length, tiers: 4 });
  });

  it('読み込み: 知らない勲章・壊れた時刻・段階より多い時刻は捨てる', () => {
    const b = normalizeBadges({
      earned: { loop: [5], nope: [1], campaign: [1, 2, 3, 4], ace: ['x'], dailyStreak: [1, -1] },
      backfilled: true,
    });
    expect(b).toEqual({
      earned: { loop: [5], campaign: [1, 2, 3], dailyStreak: [1] },
      backfilled: true,
      milestones: 0,
    });
    expect(normalizeBadges(null)).toEqual({ earned: {}, backfilled: false, milestones: 0 });
    expect(normalizeBadges({ earned: { 'l.kill.10': [7] }, milestones: 2 })).toMatchObject({
      earned: { 'l.kill.10': [7] },
      milestones: 2,
    });
  });

  it('v9 → v10 → v11 の移行で空の勲章・空の通算の記録を足す（ほかはそのまま）', () => {
    const v9: Record<string, unknown> = { ...createInitialSave(), version: 9, credits: 4321 };
    delete v9.badges;
    const step = SAVE_MIGRATIONS[9];
    expect(step).toBeDefined();
    const save = parseSave(JSON.stringify(v9));
    expect(save?.version).toBe(11);
    expect(save?.credits).toBe(4321);
    expect(save?.badges).toEqual({ earned: {}, backfilled: false, milestones: 0 });
    expect(save?.stats).toEqual({ counts: {}, since: 0, lastDaily: null });
  });
});

describe('記録からの判定とさかのぼり', () => {
  /** 9-10 より前（v9）のセーブ: キャンペーン全部 A 以上（1 本 S 以外）・レース全コース完走・レイド・防衛戦・練習場・日替わり 7 日 */
  function v9Veteran(): Record<string, unknown> {
    const d: Record<string, unknown> & ReturnType<typeof createInitialSave> = {
      ...createInitialSave(),
      version: 9,
      credits: 1000,
    };
    MISSIONS.forEach((m, i) => {
      d.missions[m.id] = { unlocked: true, bestRank: i === 0 ? 'A' : 'S' };
    });
    for (const c of COURSES) d.races[c.id] = { ...emptyRaceRecord(), bestRank: 'B', clears: 1 };
    d.records.raidBestMs = { normal: 300000, 'nephirga:hard': 500000 };
    d.records.defenseWaves = { 'island:normal': 10, 'harbor:hard': 6 };
    d.records.tutorial = [...TUTORIAL_CHAPTERS];
    d.records.daily.streak = { last: '2026-11-04', count: 7 };
    d.skins.pvpKills = 3;
    const out: Record<string, unknown> = { ...d };
    delete out.badges;
    return out;
  }

  it('v9 のセーブから記録で取れる勲章をさかのぼって付ける（報酬つき・2 回目は何も付かない）', () => {
    const save = parseSave(JSON.stringify(v9Veteran()));
    if (!save) throw new Error('save');
    const got = syncRecordBadges(save, 1_700_000_000_000);
    const tiers = Object.fromEntries(got.map((a) => [`${a.id}:${String(a.tier)}`, true]));
    expect(Object.keys(tiers).sort()).toEqual(
      [
        'firstKill:1',
        'campaign:1',
        'campaign:2',
        'tutorial:1',
        'vorgas:1',
        'nephirga:1',
        'raidHard:1',
        'raceMedals:1',
        'defenseAll:1',
        'dailyStreak:1',
        'dailyStreak:2',
        // 9-10b: 記録からさかのぼれる組み合わせ（ヴォルガス通常のクリアと 7 分未満・ネフィルガ高難度・島の防衛戦の通常）
        'c.raidClear.vorgas.normal:1',
        'c.raidTimed.vorgas.normal:1',
        'c.raidClear.nephirga.hard:1',
        'c.defenseClear.island.normal:1',
        // 15 個で節目（10 個）の報酬
        ':1',
      ].sort(),
    );
    expect(got.find((a) => a.milestone !== undefined)).toEqual({
      id: '',
      tier: 1,
      credits: BADGE_REWARDS.milestone,
      milestone: 10,
    });
    const credits = got.reduce((s, a) => s + a.credits, 0);
    expect(save.credits).toBe(1000 + credits);
    expect(earnedTier(save.badges, 'campaign')).toBe(2);
    // 取っていないものの進み具合
    const r = recordBadges(save);
    expect(r.campaign?.progress).toEqual({ current: MISSIONS.length - 1, goal: MISSIONS.length });
    expect(r.raceMedals?.progress).toEqual({ current: 0, goal: COURSES.length });
    expect(r.pvpKills?.progress).toEqual({ current: 3, goal: BADGE_CONFIG.pvpKills });
    expect(r.defenseHard?.tier).toBe(0);
    // もう一度判定しても増えない（報酬も 1 回だけ）
    const before = save.credits;
    expect(syncRecordBadges(save, 1_700_000_100_000)).toEqual([]);
    expect(save.credits).toBe(before);
  });

  it('記録が良くなると次の段階が付く（キャンペーン全 S で金）', () => {
    const save = parseSave(JSON.stringify(v9Veteran()));
    if (!save) throw new Error('save');
    syncRecordBadges(save, 1);
    const first = MISSIONS[0];
    if (!first) throw new Error('missions');
    save.missions[first.id] = { unlocked: true, bestRank: 'S' };
    expect(syncRecordBadges(save, 2)).toEqual([
      { id: 'campaign', tier: 3, credits: findBadge('campaign')?.rewards[2] },
    ]);
    expect(save.badges.earned.campaign).toEqual([1, 1, 2]);
  });

  it('初回起動（記録なし）は何も付かない', () => {
    const save = createInitialSave();
    expect(syncRecordBadges(save, 1)).toEqual([]);
    expect(save.credits).toBe(0);
  });
});
