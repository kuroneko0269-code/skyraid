// 勲章（9-10）のセーブと記録からの判定（Three.js・DOM 非依存）: セーブの badges（v10 から）に、取った勲章の段階ごとの時刻を持つ。
// 記録（キャンペーンの評価・レースのベスト・レイドのクリア・防衛戦の波・練習場・日替わりの連続・PvP の撃墜の累計・チュートリアル）
// から取れるものは recordBadges が今のセーブから計算する。起動のたび・保存のたびに同じ計算をするので、9-10 より前の記録も
// 最初の起動でさかのぼって付く（backfilled はそのお知らせを 1 回だけ出す印）。
// 飛行の中の出来事から取るもの（操縦・戦い）は src/missions/badges/ が判定し、ここの awardBadges で入れる。
// 9-10c: 段階（銅・銀・金）をやめて 1 段ずつ別の勲章にした（古い段階の時刻は読むときに分けた id へ移す）
import { BADGE_CONFIG, BADGES, findBadge, type BadgeDef } from '../data/badges';
import { BADGE_REWARDS, comboId, SPLIT_BADGES } from '../data/badges-catalog';
import { statShown } from '../data/badges-text';
import { DEFENSE_DIFFICULTIES, DEFENSE_MAPS } from '../data/defense';
import { RAID_DIFFICULTIES, RAID_RULES } from '../data/raid';
import { raidRecordKey, shownRaidKaiju } from '../data/raid-kaiju';
import { statSum } from './stats';
import { COURSES } from '../data/courses';
import { DAILY_KINDS } from '../data/daily';
import { DEFENSE_CONFIG } from '../data/defense';
import { MISSIONS } from '../data/missions';
import { PRACTICE_DRILLS } from '../data/practice';
import { RANKS, type Rank } from '../data/ranking';
import { TUTORIAL_CHAPTERS } from '../data/tutorial';
import { SAVE_CONFIG } from '../data/save';
import type { SaveData } from './save';
import { isObject } from './save-settings';

/** 残高に足す（save.ts の clampCredits と同じ。save.ts がこのファイルを読むので循環させない） */
const addCredits = (credits: number, amount: number): number =>
  Math.min(SAVE_CONFIG.maxCredits, Math.max(0, Math.round(credits + amount)));

export interface SaveBadges {
  /** 勲章 id → [取った時刻（ミリ秒）]（9-10b までの段階付きは段階ごとの時刻だった。9-10c で 1 つずつの id に分けた） */
  earned: Record<string, number[]>;
  /** 記録からのさかのぼりのお知らせを出した（v10 に移した直後の最初の判定で立てる） */
  backfilled: boolean;
  /** 9-10b: 払った節目の数（勲章を BADGE_REWARDS.milestoneEvery 個取るごとに 1 つ） */
  milestones: number;
}

export function defaultBadges(): SaveBadges {
  return { earned: {}, backfilled: false, milestones: 0 };
}

const validTime = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * 読み込んだ値を確かめる（知らない勲章・壊れた時刻は捨てる）。9-10c: 段階付きだった 3 つ（SPLIT_BADGES）は段階ごとの時刻を
 * 分けた id に移す（分けた先をもう持っていればそちらのまま）
 */
export function normalizeBadges(raw: unknown): SaveBadges {
  const out = defaultBadges();
  if (!isObject(raw)) return out;
  out.backfilled = raw.backfilled === true;
  if (typeof raw.milestones === 'number' && Number.isInteger(raw.milestones) && raw.milestones > 0)
    out.milestones = raw.milestones;
  if (!isObject(raw.earned)) return out;
  const earned: Record<string, unknown> = { ...raw.earned };
  for (const [old, ids] of Object.entries(SPLIT_BADGES)) {
    const v = raw.earned[old];
    if (!Array.isArray(v)) continue;
    // 段階は順に取るので、壊れた時刻の所で止める。[0] は古い id と同じ（そのまま下で読む）
    for (let k = 1; k < ids.length && validTime(v[k - 1]); k++) {
      const id = ids[k];
      const x: unknown = v[k];
      if (id !== undefined && !(id in earned) && validTime(x)) earned[id] = [x];
    }
  }
  for (const [id, v] of Object.entries(earned)) {
    if (!findBadge(id) || !Array.isArray(v)) continue;
    const x: unknown = v[0];
    if (validTime(x)) out.earned[id] = [Math.round(x)];
  }
  return out;
}

/** 取っているか */
export function hasBadge(b: Readonly<SaveBadges>, id: string): boolean {
  return (b.earned[id]?.length ?? 0) > 0;
}

/** 取った時刻（取っていなければ 0） */
export function earnedAt(b: Readonly<SaveBadges>, id: string): number {
  return b.earned[id]?.[0] ?? 0;
}

/** 新しく取った勲章（9-10b: milestone は節目の報酬。そのときの id は空・milestone に取った数） */
export interface BadgeAward {
  readonly id: string;
  readonly credits: number;
  readonly milestone?: number;
}

/** 勲章を入れて報酬のクレジットを足す。新しく取ったものを返す（取っていれば空・知らない id は無視） */
export function awardBadges(data: SaveData, ids: readonly string[], at: number): BadgeAward[] {
  const out: BadgeAward[] = [];
  for (const id of ids) {
    const def = findBadge(id);
    if (!def || hasBadge(data.badges, def.id)) continue;
    data.badges.earned[def.id] = [Math.round(at)];
    data.credits = addCredits(data.credits, def.reward);
    out.push({ id: def.id, credits: def.reward });
  }
  return out;
}

/** 進み具合（今の値 / 次の段階の目標。数えられない勲章は null） */
export interface BadgeProgress {
  readonly current: number;
  readonly goal: number;
}

/** 記録から決まる勲章（初撃墜・キャンペーン・訓練課程・レイド・レース・防衛戦・練習熱心・日替わり・撃墜王と 9-10b の段階の数えなど）の取れるかと進み具合 */
export interface RecordBadge {
  readonly done: boolean;
  readonly progress: BadgeProgress | null;
}

const rankIndex = (r: Rank | null): number => (r === null ? RANKS.length : RANKS.indexOf(r));

/** ランクの並びのうち、need（RANKS の位置）以上の数がすべてか（クリア = 最も低いランク以上） */
function rankCount(ranks: readonly (Rank | null)[], need: Rank): RecordBadge {
  return count(ranks.filter((r) => rankIndex(r) <= RANKS.indexOf(need)).length, ranks.length);
}

/** 数（current）としきい値から取れるかと進み具合 */
function count(current: number, goal: number): RecordBadge {
  const done = current >= goal;
  return { done, progress: done ? null : { current: Math.min(current, goal), goal } };
}

const yes = (ok: boolean): RecordBadge => ({ done: ok, progress: null });

/**
 * 今のセーブの記録から決まる勲章の段階と進み具合。
 * 日替わりの連続は最後に遊んだ日までの連続（途切れていても次に遊ぶまで残る数。取った段階は消えない）
 */
export function recordBadges(data: Readonly<SaveData>): Record<string, RecordBadge> {
  const r = data.records;
  const rank = (id: string): Rank | null => data.missions[id]?.bestRank ?? null;
  const dailyKinds = new Set(Object.values(r.daily.days).map((d) => d.kind));
  const tutorialDone = TUTORIAL_CHAPTERS.filter((c) => r.tutorial.includes(c)).length;
  const practiceDone = PRACTICE_DRILLS.filter((d) => (r.practice[d]?.length ?? 0) > 0).length;
  const missions = MISSIONS.map((m) => rank(m.id));
  const races = COURSES.map((c) => data.races[c.id]?.bestRank ?? null);
  const lowest = RANKS[RANKS.length - 1] ?? 'C';
  const [d3, d7, d30] = BADGE_CONFIG.dailyStreak;
  const streak = r.daily.streak.count;
  return {
    // M1・M2 は敵機を落とさないとクリアできない。PvP で落としていても
    firstKill: yes(
      rank('training') !== null || rank('first-sortie') !== null || data.skins.pvpKills > 0,
    ),
    campaign: rankCount(missions, lowest),
    campaignA: rankCount(missions, 'A'),
    campaignS: rankCount(missions, 'S'),
    tutorial: count(tutorialDone, TUTORIAL_CHAPTERS.length),
    raceMedals: rankCount(races, lowest),
    raceMedalsA: rankCount(races, 'A'),
    raceMedalsS: rankCount(races, 'S'),
    practiceAll: count(practiceDone, PRACTICE_DRILLS.length),
    dailyStreak: count(streak, d3 ?? 3),
    dailyStreak7: count(streak, d7 ?? 7),
    dailyStreak30: count(streak, d30 ?? 30),
    dailyAll: count(DAILY_KINDS.filter((k) => dailyKinds.has(k)).length, DAILY_KINDS.length),
    pvpKills: count(data.skins.pvpKills, BADGE_CONFIG.pvpKills),
    ...extraRecordBadges(data),
  };
}

/**
 * 9-10b: 通算の記録の段階の数え・記録からさかのぼれる組み合わせ（怪獣 × 難易度のクリアと時間内・防衛戦のマップ × 難易度）・集め
 */
function extraRecordBadges(data: Readonly<SaveData>): Record<string, RecordBadge> {
  const out: Record<string, RecordBadge> = {};
  const r = data.records;
  for (const def of BADGES) {
    const s = def.stat;
    if (!s) continue;
    const value = statSum(data.stats, s.keys);
    const done = value >= s.goal;
    out[def.id] = {
      done,
      progress: done ? null : { current: Math.min(statShown(s, value), s.shown), goal: s.shown },
    };
  }
  // 速攻: 報酬の時間ボーナスの最も速い段（7 分未満）と同じ
  const fast = RAID_RULES.reward.timeBonus[0].underSeconds * 1000;
  for (const { id: kaiju } of shownRaidKaiju()) {
    for (const diff of RAID_DIFFICULTIES) {
      const best = r.raidBestMs[raidRecordKey(kaiju, diff)];
      out[comboId.raidClear(kaiju, diff)] = yes(best !== undefined);
      out[comboId.raidTimed(kaiju, diff)] = yes(best !== undefined && best < fast);
    }
  }
  for (const m of DEFENSE_MAPS)
    for (const diff of DEFENSE_DIFFICULTIES)
      out[comboId.defenseClear(m.mapId, diff)] = yes(
        (r.defenseWaves[`${m.mapId}:${diff}`] ?? 0) >= DEFENSE_CONFIG.waves,
      );
  // 集め: 集め以外の勲章のうち取った数
  const pool = BADGES.filter((d) => d.collect === undefined);
  const have = pool.filter((d) => hasBadge(data.badges, d.id)).length;
  for (const def of BADGES) {
    if (def.collect === undefined) continue;
    out[def.id] = count(have, Math.ceil(pool.length * def.collect));
  }
  return out;
}

/**
 * 記録から取れる勲章を入れる（起動・保存のたび。9-10 より前の記録はここでさかのぼって付く）。
 * 新しく取った段階を返す
 */
export function syncRecordBadges(data: SaveData, at: number): BadgeAward[] {
  const out: BadgeAward[] = [];
  // 集めは取った数で決まるので、新しく取らなくなるまで繰り返す（割合は 4 段なので数回で止まる）
  for (let pass = 0; pass < 6; pass++) {
    const wins = Object.entries(recordBadges(data))
      .filter(([id, b]) => b.done && !hasBadge(data.badges, id))
      .map(([id]) => id);
    if (wins.length === 0) break;
    out.push(...awardBadges(data, wins, at));
  }
  out.push(...awardMilestones(data));
  return out;
}

/** 9-10b: 節目の報酬（勲章を milestoneEvery 個取るごと）。払っていない節目をまとめて払う */
export function awardMilestones(data: SaveData): BadgeAward[] {
  const out: BadgeAward[] = [];
  const earned = badgeTotals(data.badges).earned;
  const due = Math.floor(earned / BADGE_REWARDS.milestoneEvery);
  while (data.badges.milestones < due) {
    data.badges.milestones++;
    const credits = BADGE_REWARDS.milestone;
    data.credits = addCredits(data.credits, credits);
    out.push({
      id: '',
      credits,
      milestone: data.badges.milestones * BADGE_REWARDS.milestoneEvery,
    });
  }
  return out;
}

/** 次の節目（取った数・あと何個・報酬）。9-10c で勲章をまとめて数が減っても、払った節目の次から */
export function nextMilestone(b: Readonly<SaveBadges>): {
  at: number;
  left: number;
  credits: number;
} {
  const earned = badgeTotals(b).earned;
  const every = BADGE_REWARDS.milestoneEvery;
  const at = (Math.max(Math.floor(earned / every), b.milestones) + 1) * every;
  return { at, left: at - earned, credits: BADGE_REWARDS.milestone };
}

/** 一覧の数え: 取った勲章の数と全部の数 */
export function badgeTotals(b: Readonly<SaveBadges>): { earned: number; total: number } {
  const earned = BADGES.filter((def) => hasBadge(b, def.id)).length;
  return { earned, total: BADGES.length };
}

/** 報酬の合計 */
export function totalBadgeRewards(list: readonly BadgeDef[] = BADGES): number {
  return list.reduce((sum, d) => sum + d.reward, 0);
}
