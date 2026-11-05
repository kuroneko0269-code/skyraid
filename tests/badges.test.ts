// 勲章（9-10）: 操縦の判定（宙返り・インメルマン・低空・背面・最高速。旋回・置き直しでは取れない）・記録からの判定と
// さかのぼり（v9 のセーブから）・入れ方（1 回だけ・報酬・段階）・読み込みの確かめ・補助の組の判定・協力 / PvP の集計
import { describe, expect, it } from 'vitest';
import { BADGE_CONFIG, BADGES, badgeTiers, findBadge } from '../src/data/badges';
import { COURSES } from '../src/data/courses';
import { MISSIONS } from '../src/data/missions';
import { TUTORIAL_CHAPTERS } from '../src/data/tutorial';
import { multiplyQuat, quatIdentity, type Quat } from '../src/flight/math';
import { ManeuverWatch, type ManeuverSample } from '../src/missions/badges/maneuvers';
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

const DT = 1 / 60;

/** 軸の回転（x・y・z の単位ベクトルのまわりに a ラジアン） */
function axisQuat(ax: 'x' | 'y' | 'z', a: number): Quat {
  const s = Math.sin(a / 2);
  return {
    x: ax === 'x' ? s : 0,
    y: ax === 'y' ? s : 0,
    z: ax === 'z' ? s : 0,
    w: Math.cos(a / 2),
  };
}

const mul = (a: Quat, b: Quat): Quat => multiplyQuat(quatIdentity(), a, b);

interface Pose {
  x: number;
  y: number;
  z: number;
  q: Quat;
  speed?: number;
  agl?: number;
}

/** 姿勢の並びを流す（地表の高さは 0。agl を渡せば上書き） */
function run(poses: readonly Pose[], w = new ManeuverWatch()): ManeuverWatch {
  for (const p of poses) {
    const s: ManeuverSample = {
      position: { x: p.x, y: p.y, z: p.z },
      orientation: p.q,
      speed: p.speed ?? 250,
      agl: p.agl ?? p.y,
      active: true,
      downs: 0,
    };
    w.step(s, DT);
  }
  return w;
}

/** 水平に seconds 秒（向き q のまま -Z へ進む） */
function level(seconds: number, from: Pose): Pose[] {
  const out: Pose[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) out.push({ ...from, z: from.z - (from.speed ?? 250) * DT * i });
  return out;
}

/** 縦の円（半径 r・angle まで）。始めは水平で -Z 向き */
function pitchArc(angle: number, seconds: number, y0: number, r = 200): Pose[] {
  const out: Pose[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i <= n; i++) {
    const th = (angle * i) / n;
    out.push({ x: 0, y: y0 + r * (1 - Math.cos(th)), z: -r * Math.sin(th), q: axisQuat('x', th) });
  }
  return out;
}

describe('操縦の判定', () => {
  it('宙返り: 縦に 1 周すると取れる。旋回（バンク 80° の水平の引き）では取れない', () => {
    const lead = level(1, { x: 0, y: 1000, z: 0, q: quatIdentity() });
    expect([...run([...lead, ...pitchArc(Math.PI * 2, 6, 1000)]).done]).toContain('loop');
    // 半分では取れない
    expect(run([...lead, ...pitchArc(Math.PI, 3, 1000)]).done.has('loop')).toBe(false);
    // バンク 80° で水平に 2 周（機首は真上を向かない）
    const turn: Pose[] = [];
    const bank = axisQuat('z', (-80 * Math.PI) / 180);
    for (let i = 0; i <= 600; i++) {
      const psi = (Math.PI * 4 * i) / 600;
      turn.push({
        x: Math.sin(psi) * 400,
        y: 1000,
        z: Math.cos(psi) * 400,
        q: mul(axisQuat('y', psi), bank),
      });
    }
    expect(run(turn).done.size).toBe(0);
  });

  it('インメルマン: 半宙返りの後に背面から水平へ戻すと取れる（向きが逆・高く）。宙返りの途中の置き直しではやり直す', () => {
    const lead = level(1, { x: 0, y: 1000, z: 0, q: quatIdentity() });
    const half = pitchArc(Math.PI, 3, 1000);
    const top = half[half.length - 1];
    if (!top) throw new Error('arc');
    const roll: Pose[] = [];
    for (let i = 0; i <= 60; i++)
      roll.push({
        ...top,
        z: top.z + 4 * i,
        q: mul(axisQuat('x', Math.PI), axisQuat('z', (Math.PI * i) / 60)),
      });
    const w = run([...lead, ...half, ...roll]);
    expect(w.done.has('immelmann')).toBe(true);
    expect(w.done.has('loop')).toBe(false);
    // 宙返りの途中で 500m 跳んだ（復帰・置き直し）ら数え直す
    const arc = pitchArc(Math.PI * 2, 6, 1000);
    const jumped = arc.map((p, i) => (i > 180 ? { ...p, x: p.x + 500 } : p));
    expect(run([...lead, ...jumped]).done.has('loop')).toBe(false);
  });

  it('背面飛行・低空飛行・最高速', () => {
    const inv = mul(quatIdentity(), axisQuat('z', Math.PI));
    expect(run(level(10.5, { x: 0, y: 500, z: 0, q: inv })).done.has('inverted')).toBe(true);
    expect(run(level(9, { x: 0, y: 500, z: 0, q: inv })).done.has('inverted')).toBe(false);
    // 地表から 100m 未満は数えない
    expect(run(level(11, { x: 0, y: 80, z: 0, q: inv })).done.has('inverted')).toBe(false);
    const c = BADGE_CONFIG.lowPass;
    const low = { x: 0, y: 20, z: 0, q: quatIdentity(), speed: c.minSpeed + 10 };
    expect(run(level(c.seconds + 0.5, low)).done.has('lowPass')).toBe(true);
    expect(run(level(c.seconds + 0.5, { ...low, y: c.maxAglM + 5 })).done.has('lowPass')).toBe(
      false,
    );
    expect(
      run(level(c.seconds + 0.5, { ...low, speed: c.minSpeed - 10 })).done.has('lowPass'),
    ).toBe(false);
    const fast = { x: 0, y: 900, z: 0, q: quatIdentity(), speed: BADGE_CONFIG.topSpeed };
    expect(run(level(0.1, fast)).done.has('topSpeed')).toBe(true);
    expect(run(level(1, { ...fast, speed: 420 })).done.has('topSpeed')).toBe(false);
  });

  it('撃墜されている間・撃墜の数が変わったら数え直す', () => {
    const w = new ManeuverWatch();
    const poses = level(10.5, { x: 0, y: 500, z: 0, q: axisQuat('z', Math.PI) });
    poses.forEach((p, i) => {
      w.step(
        {
          position: p,
          orientation: p.q,
          speed: 250,
          agl: 500,
          active: true,
          downs: i > 300 ? 1 : 0,
        },
        DT,
      );
    });
    expect(w.done.has('inverted')).toBe(false);
  });
});

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
    expect(judgeMatch({ coop: true, coopClear: true, players: 2, pvpWin: false })).toEqual([
      'coopClear',
    ]);
    expect(judgeMatch({ coop: true, coopClear: true, players: 4, pvpWin: false })).toEqual([
      'coopClear',
      'coopFour',
    ]);
    expect(judgeMatch({ coop: true, coopClear: false, players: 4, pvpWin: false })).toEqual([]);
    expect(judgeMatch({ coop: false, coopClear: false, players: 3, pvpWin: true })).toEqual([
      'pvpWin',
    ]);
    expect(judgeMatch({ coop: false, coopClear: false, players: 1, pvpWin: true })).toEqual([]);
  });
});

describe('勲章の定義', () => {
  it('20〜30 個・id は重ならない・段階は 1 か 3・報酬は正・名前と条件の文がある', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(20);
    expect(BADGES.length).toBeLessThanOrEqual(30);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    for (const b of BADGES) {
      expect([1, 3]).toContain(badgeTiers(b));
      for (const r of b.rewards) expect(r).toBeGreaterThan(0);
    }
    // 1 回だけの報酬の合計（稼ぎ場にならない大きさ: キャンペーン 8 本を全部 S にした報酬の合計の程度）
    expect(totalBadgeRewards()).toBe(46500);
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
    });
    expect(normalizeBadges(null)).toEqual({ earned: {}, backfilled: false });
  });

  it('v9 → v10 の移行で空の勲章を足す（ほかはそのまま）', () => {
    const v9: Record<string, unknown> = { ...createInitialSave(), version: 9, credits: 4321 };
    delete v9.badges;
    const step = SAVE_MIGRATIONS[9];
    expect(step).toBeDefined();
    const save = parseSave(JSON.stringify(v9));
    expect(save?.version).toBe(10);
    expect(save?.credits).toBe(4321);
    expect(save?.badges).toEqual({ earned: {}, backfilled: false });
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
      ].sort(),
    );
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
