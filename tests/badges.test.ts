// 勲章（9-10・9-10c）: 記録からの判定と
// さかのぼり（v9 のセーブから）・入れ方（1 回だけ・報酬）・読み込みの確かめ（段階付きだった勲章の移し替え）・補助の組の判定・協力 / PvP の集計
import { describe, expect, it } from 'vitest';
import { BADGE_CONFIG, BADGES, badgeName, badgeNote, findBadge } from '../src/data/badges';
import { BADGE_REWARDS } from '../src/data/badges-catalog';
import { useLocale } from './i18n-helpers';
import { COURSES } from '../src/data/courses';
import { MISSIONS } from '../src/data/missions';
import { TUTORIAL_CHAPTERS } from '../src/data/tutorial';
import { assistQualifies, judgeMatch } from '../src/missions/badges/sortie';
import {
  awardBadges,
  badgeTotals,
  hasBadge,
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
  it('150〜300 個・id は重ならない・報酬は正', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(150);
    expect(BADGES.length).toBeLessThanOrEqual(300);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    for (const b of BADGES) expect(b.reward).toBeGreaterThan(0);
  });

  it('報酬: 9-10 からの勲章は 9-10 のまま（段階は 1 つずつに分けて合計 38,000 CR）・9-10b からは 1 つ 100 CR・収集 4 つで 15,000 CR', () => {
    const legacy = BADGES.filter((b) => !b.stat && !b.combo && b.collect === undefined);
    // 10-3b: アルビオンの巣（albionNests 2,000 CR）、10-3c: 当たらずに倒した（albionUntouched 2,000 CR）を足した
    expect(legacy.length).toBe(31);
    expect(totalBadgeRewards(legacy)).toBe(42000);
    const collect = BADGES.filter((b) => b.collect !== undefined);
    expect(collect.map((b) => b.reward)).toEqual([1000, 2000, 4000, 8000]);
    for (const b of BADGES) if (b.stat || b.combo) expect(b.reward).toBe(BADGE_REWARDS.each);
    const milestones =
      Math.floor(BADGES.length / BADGE_REWARDS.milestoneEvery) * BADGE_REWARDS.milestone;
    // 合わせて 10 万 CR 以内（使い道の合計 316,000 CR の 3 分の 1 以下。docs/control-analysis.md）
    expect(totalBadgeRewards() + milestones).toBeLessThanOrEqual(100_000);
  });

  it('名前（「〜した」の文）と補足が日本語・英語ともにある（キーのまま出ない）', () => {
    for (const lang of ['ja', 'en'] as const) {
      useLocale(lang);
      for (const b of BADGES) {
        const name = badgeName(b.id);
        const note = badgeNote(b.id);
        expect(name).not.toContain('badges.');
        expect(note).not.toContain('badges.');
        expect(name).not.toMatch(/[{}]/);
        expect(note).not.toMatch(/[{}]/);
        // 日本語は「〜した」「〜飛んだ」などの過去形で終わる
        if (lang === 'ja') expect(name).toMatch(/[ただ]$/);
      }
      // 名前は重ならない（同じ文の勲章が 2 つ無い）
      expect(new Set(BADGES.map((b) => badgeName(b.id))).size).toBe(BADGES.length);
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
  it('1 回だけ・報酬を足す・知らない id は無視', () => {
    const d = createInitialSave();
    d.credits = 100;
    expect(awardBadges(d, ['loop'], 1000)).toEqual([{ id: 'loop', credits: 300 }]);
    expect(d.credits).toBe(400);
    expect(awardBadges(d, ['loop'], 2000)).toEqual([]);
    expect(d.credits).toBe(400);
    expect(awardBadges(d, ['nope', 'ace', 'campaignA'], 3000)).toEqual([
      { id: 'ace', credits: 1000 },
      { id: 'campaignA', credits: 2000 },
    ]);
    expect(d.badges.earned.ace).toEqual([3000]);
    expect(d.credits).toBe(3400);
    expect(badgeTotals(d.badges)).toEqual({ earned: 3, total: BADGES.length });
  });

  it('読み込み: 知らない勲章（9-10c で消した 5 つも）・壊れた時刻は捨て、段階付きだった 3 つは段階ごとに分けた id へ移す', () => {
    const b = normalizeBadges({
      earned: {
        loop: [5],
        nope: [1],
        vorgas: [9],
        defenseHard: [9],
        campaign: [1, 2, 3, 4],
        raceMedals: [7],
        ace: ['x'],
        dailyStreak: [1, -1, 3],
      },
      backfilled: true,
    });
    expect(b).toEqual({
      earned: {
        loop: [5],
        campaign: [1],
        campaignA: [2],
        campaignS: [3],
        raceMedals: [7],
        dailyStreak: [1],
      },
      backfilled: true,
      milestones: 0,
    });
    // 一度移したセーブ（分けた id を持っている）を読み直しても変わらない
    expect(normalizeBadges(b)).toEqual(b);
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

describe('9-10c: 今の版（v11）のセーブを読む', () => {
  it('取った勲章（段階付きは分けた id へ）・通算の記録・クレジットが残り、もう一度判定しても取り直さない', () => {
    const v11 = createInitialSave();
    v11.credits = 123456;
    v11.stats.counts = { kill: 140, 'mv.loop': 23 };
    v11.stats.since = 1_700_000_000_000;
    for (const m of MISSIONS) v11.missions[m.id] = { unlocked: true, bestRank: 'A' };
    v11.records.raidBestMs = { normal: 300000 };
    const raw = JSON.parse(JSON.stringify(v11)) as Record<string, unknown>;
    raw.badges = {
      earned: {
        loop: [11],
        campaign: [21, 22],
        vorgas: [31],
        'c.raidClear.vorgas.normal': [31],
        'l.kill.100': [41],
      },
      backfilled: true,
      milestones: 0,
    };
    const save = parseSave(JSON.stringify(raw));
    if (!save) throw new Error('save');
    expect(save.credits).toBe(123456);
    expect(save.stats.counts).toEqual({ kill: 140, 'mv.loop': 23 });
    expect(save.stats.since).toBe(1_700_000_000_000);
    expect(save.badges.earned).toEqual({
      loop: [11],
      campaign: [21],
      campaignA: [22],
      'c.raidClear.vorgas.normal': [31],
      'l.kill.100': [41],
    });
    // 記録から決まるものは取った時刻のまま（取り直さない）。新しく付くのはまだ取っていない分だけ
    const got = syncRecordBadges(save, 9);
    expect(got.map((a) => a.id)).not.toContain('campaign');
    expect(got.map((a) => a.id)).not.toContain('campaignA');
    expect(save.badges.earned.campaign).toEqual([21]);
    expect(save.credits).toBe(123456 + got.reduce((n, a) => n + a.credits, 0));
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
    expect(got.map((a) => a.id).sort()).toEqual(
      [
        'firstKill',
        'campaign',
        'campaignA',
        'tutorial',
        'raceMedals',
        'dailyStreak',
        'dailyStreak7',
        // 記録からさかのぼれる組み合わせ（ヴォルガス通常のクリアと 7 分未満・ネフィルガ高難度・島の防衛戦の通常）
        'c.raidClear.vorgas.normal',
        'c.raidTimed.vorgas.normal',
        'c.raidClear.nephirga.hard',
        'c.defenseClear.island.normal',
        // 11 個で節目（10 個）の報酬
        '',
      ].sort(),
    );
    expect(got.find((a) => a.milestone !== undefined)).toEqual({
      id: '',
      credits: BADGE_REWARDS.milestone,
      milestone: 10,
    });
    const credits = got.reduce((s, a) => s + a.credits, 0);
    expect(save.credits).toBe(1000 + credits);
    expect(hasBadge(save.badges, 'campaignA')).toBe(true);
    expect(hasBadge(save.badges, 'campaignS')).toBe(false);
    // 取っていないものの進み具合
    const r = recordBadges(save);
    expect(r.campaignS?.progress).toEqual({ current: MISSIONS.length - 1, goal: MISSIONS.length });
    expect(r.raceMedalsA?.progress).toEqual({ current: 0, goal: COURSES.length });
    expect(r.pvpKills?.progress).toEqual({ current: 3, goal: BADGE_CONFIG.pvpKills });
    expect(r.dailyStreak30?.progress).toEqual({ current: 7, goal: 30 });
    expect(r['c.defenseClear.harbor.hard']?.done).toBe(false);
    // もう一度判定しても増えない（報酬も 1 回だけ）
    const before = save.credits;
    expect(syncRecordBadges(save, 1_700_000_100_000)).toEqual([]);
    expect(save.credits).toBe(before);
  });

  it('記録が良くなると次の段の勲章が付く（キャンペーン全 S）', () => {
    const save = parseSave(JSON.stringify(v9Veteran()));
    if (!save) throw new Error('save');
    syncRecordBadges(save, 1);
    const first = MISSIONS[0];
    if (!first) throw new Error('missions');
    save.missions[first.id] = { unlocked: true, bestRank: 'S' };
    expect(syncRecordBadges(save, 2)).toEqual([
      { id: 'campaignS', credits: findBadge('campaignS')?.reward },
    ]);
    expect(save.badges.earned.campaignS).toEqual([2]);
  });

  it('初回起動（記録なし）は何も付かない', () => {
    const save = createInitialSave();
    expect(syncRecordBadges(save, 1)).toEqual([]);
    expect(save.credits).toBe(0);
  });
});
