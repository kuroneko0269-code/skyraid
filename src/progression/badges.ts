// 勲章（9-10）のセーブと記録からの判定（Three.js・DOM 非依存）: セーブの badges（v10 から）に、取った勲章の段階ごとの時刻を持つ。
// 記録（キャンペーンの評価・レースのベスト・レイドのクリア・防衛戦の波・練習場・日替わりの連続・PvP の撃墜の累計・チュートリアル）
// から取れるものは recordBadges が今のセーブから計算する。起動のたび・保存のたびに同じ計算をするので、9-10 より前の記録も
// 最初の起動でさかのぼって付く（backfilled はそのお知らせを 1 回だけ出す印）。
// 飛行の中の出来事から取るもの（操縦・戦い）は src/missions/badges/ が判定し、ここの awardBadges で入れる
import { BADGE_CONFIG, BADGES, badgeTiers, findBadge, type BadgeDef } from '../data/badges';
import { COURSES } from '../data/courses';
import { DAILY_KINDS } from '../data/daily';
import { DEFENSE_CONFIG } from '../data/defense';
import { MISSIONS } from '../data/missions';
import { PRACTICE_DRILLS } from '../data/practice';
import { NEPHIRGA_ID, raidKaijuOfKey, VORGAS_ID } from '../data/raid-kaiju';
import { RANKS, type Rank } from '../data/ranking';
import { TUTORIAL_CHAPTERS } from '../data/tutorial';
import { SAVE_CONFIG } from '../data/save';
import type { SaveData } from './save';
import { isObject } from './save-settings';

/** 残高に足す（save.ts の clampCredits と同じ。save.ts がこのファイルを読むので循環させない） */
const addCredits = (credits: number, amount: number): number =>
  Math.min(SAVE_CONFIG.maxCredits, Math.max(0, Math.round(credits + amount)));

export interface SaveBadges {
  /** 勲章 id → 取った段階ごとの時刻（ミリ秒。[0] が銅（段階なしは取った時刻）、[1] 銀、[2] 金） */
  earned: Record<string, number[]>;
  /** 記録からのさかのぼりのお知らせを出した（v10 に移した直後の最初の判定で立てる） */
  backfilled: boolean;
}

export function defaultBadges(): SaveBadges {
  return { earned: {}, backfilled: false };
}

/** 読み込んだ値を確かめる（知らない勲章・壊れた時刻は捨てる） */
export function normalizeBadges(raw: unknown): SaveBadges {
  const out = defaultBadges();
  if (!isObject(raw)) return out;
  out.backfilled = raw.backfilled === true;
  if (!isObject(raw.earned)) return out;
  for (const [id, v] of Object.entries(raw.earned)) {
    const def = findBadge(id);
    if (!def || !Array.isArray(v)) continue;
    const times: number[] = [];
    for (const x of v.slice(0, badgeTiers(def))) {
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) break;
      times.push(Math.round(x));
    }
    if (times.length > 0) out.earned[id] = times;
  }
  return out;
}

/** 取った段階（0 は未取得） */
export function earnedTier(b: Readonly<SaveBadges>, id: string): number {
  return b.earned[id]?.length ?? 0;
}

/** 新しく取った勲章の段階 */
export interface BadgeAward {
  readonly id: string;
  readonly tier: number;
  readonly credits: number;
}

/**
 * 勲章を入れる（tier までの段階をまとめて。取っている段階はそのまま）。報酬のクレジットを足す。
 * 新しく取った段階を返す（取っていれば空）
 */
export function awardBadges(
  data: SaveData,
  wins: readonly { readonly id: string; readonly tier: number }[],
  at: number,
): BadgeAward[] {
  const out: BadgeAward[] = [];
  for (const w of wins) {
    const def = findBadge(w.id);
    if (!def) continue;
    const tier = Math.min(badgeTiers(def), Math.floor(w.tier));
    const times = data.badges.earned[def.id] ?? [];
    for (let k = times.length; k < tier; k++) {
      times.push(Math.round(at));
      const credits = def.rewards[k] ?? 0;
      data.credits = addCredits(data.credits, credits);
      out.push({ id: def.id, tier: k + 1, credits });
    }
    if (times.length > 0) data.badges.earned[def.id] = times;
  }
  return out;
}

/** 進み具合（今の値 / 次の段階の目標。数えられない勲章は null） */
export interface BadgeProgress {
  readonly current: number;
  readonly goal: number;
}

/** 記録から決まる勲章（初撃墜・キャンペーン・訓練課程・レイド 3 つ・レース・防衛戦 2 つ・練習熱心・日替わり 2 つ・撃墜王）の今の段階と、次の段階への進み具合 */
export interface RecordBadge {
  readonly tier: number;
  readonly progress: BadgeProgress | null;
}

const rankIndex = (r: Rank | null): number => (r === null ? RANKS.length : RANKS.indexOf(r));

/** ランクの並び（全部 クリア / A 以上 / S）で段階を数える。銅 = すべてクリア・銀 = すべて A 以上・金 = すべて S */
function rankTiers(ranks: readonly (Rank | null)[]): RecordBadge {
  const need = [RANKS.length - 1, RANKS.indexOf('A'), RANKS.indexOf('S')];
  let tier = 0;
  for (const n of need) {
    if (ranks.every((r) => rankIndex(r) <= n)) tier++;
    else break;
  }
  const next = need[tier];
  const progress =
    next === undefined
      ? null
      : { current: ranks.filter((r) => rankIndex(r) <= next).length, goal: ranks.length };
  return { tier, progress };
}

/** 数（current）としきい値（段階ごと）から段階と進み具合 */
function countTiers(current: number, goals: readonly number[]): RecordBadge {
  let tier = 0;
  while (tier < goals.length && current >= (goals[tier] ?? Infinity)) tier++;
  const goal = goals[tier];
  return { tier, progress: goal === undefined ? null : { current: Math.min(current, goal), goal } };
}

const yes = (ok: boolean): RecordBadge => ({ tier: ok ? 1 : 0, progress: null });

/**
 * 今のセーブの記録から決まる勲章の段階と進み具合。
 * 日替わりの連続は最後に遊んだ日までの連続（途切れていても次に遊ぶまで残る数。取った段階は消えない）
 */
export function recordBadges(data: Readonly<SaveData>): Record<string, RecordBadge> {
  const r = data.records;
  const rank = (id: string): Rank | null => data.missions[id]?.bestRank ?? null;
  const raidKeys = Object.keys(r.raidBestMs);
  const fullWaves = (key: string): boolean => (r.defenseWaves[key] ?? 0) >= DEFENSE_CONFIG.waves;
  const defenseKeys = Object.keys(r.defenseWaves);
  const dailyKinds = new Set(Object.values(r.daily.days).map((d) => d.kind));
  const tutorialDone = TUTORIAL_CHAPTERS.filter((c) => r.tutorial.includes(c)).length;
  const practiceDone = PRACTICE_DRILLS.filter((d) => (r.practice[d]?.length ?? 0) > 0).length;
  return {
    // M1・M2 は敵機を落とさないとクリアできない。PvP で落としていても
    firstKill: yes(
      rank('training') !== null || rank('first-sortie') !== null || data.skins.pvpKills > 0,
    ),
    campaign: rankTiers(MISSIONS.map((m) => rank(m.id))),
    tutorial: countTiers(tutorialDone, [TUTORIAL_CHAPTERS.length]),
    vorgas: yes(raidKeys.some((k) => raidKaijuOfKey(k) === VORGAS_ID)),
    nephirga: yes(raidKeys.some((k) => raidKaijuOfKey(k) === NEPHIRGA_ID)),
    raidHard: yes(raidKeys.some((k) => k.endsWith('hard'))),
    raceMedals: rankTiers(COURSES.map((c) => data.races[c.id]?.bestRank ?? null)),
    defenseAll: yes(defenseKeys.some(fullWaves)),
    defenseHard: yes(defenseKeys.some((k) => k.endsWith(':hard') && fullWaves(k))),
    practiceAll: countTiers(practiceDone, [PRACTICE_DRILLS.length]),
    dailyStreak: countTiers(r.daily.streak.count, BADGE_CONFIG.dailyStreak),
    dailyAll: countTiers(DAILY_KINDS.filter((k) => dailyKinds.has(k)).length, [DAILY_KINDS.length]),
    pvpKills: countTiers(data.skins.pvpKills, [BADGE_CONFIG.pvpKills]),
  };
}

/**
 * 記録から取れる勲章を入れる（起動・保存のたび。9-10 より前の記録はここでさかのぼって付く）。
 * 新しく取った段階を返す
 */
export function syncRecordBadges(data: SaveData, at: number): BadgeAward[] {
  const wins = Object.entries(recordBadges(data))
    .filter(([id, b]) => b.tier > earnedTier(data.badges, id))
    .map(([id, b]) => ({ id, tier: b.tier }));
  return wins.length > 0 ? awardBadges(data, wins, at) : [];
}

/** 一覧の数え: 取った勲章の数と全部の数、取った段階の数と全部の数 */
export function badgeTotals(b: Readonly<SaveBadges>): {
  earned: number;
  total: number;
  tiers: number;
  totalTiers: number;
} {
  let earned = 0;
  let tiers = 0;
  let totalTiers = 0;
  for (const def of BADGES) {
    const n = earnedTier(b, def.id);
    if (n > 0) earned++;
    tiers += n;
    totalTiers += badgeTiers(def);
  }
  return { earned, total: BADGES.length, tiers, totalTiers };
}

/** 報酬の合計（全部の段階） */
export function totalBadgeRewards(list: readonly BadgeDef[] = BADGES): number {
  return list.reduce((sum, d) => sum + d.rewards.reduce((a, b) => a + b, 0), 0);
}
