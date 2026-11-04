// ローカルの自己ベスト（7-D。v9 から。Three.js・DOM 非依存）: モード選択のカードに出す防衛戦の最高波とレイドの最速。
// オンライン連携（7-4）の記録とは別に、ソロのプレイの結果だけをブラウザのセーブに持つ。
// 防衛戦: key = マップ id:難易度 → クリアした波の最大（0〜10）。レイド: key = 難易度（9-6c: ネフィルガは「nephirga:難易度」）→ 撃破までの最短（ミリ秒）
// 練習場（9-5）: practice = 課題 → 設定 × 機体ごとの最高（practice-records.ts）。版は 9 のまま（無ければ空）
// チュートリアル（9-5c）: tutorial = 終えた章の id（章の一覧の ✓）。版は 9 のまま（無ければ空）
import { raidKaijuOfKey, VORGAS_ID, type RaidKaijuId } from '../data/raid-kaiju';
import { DEFENSE_CONFIG } from '../data/defense';
import { isTutorialChapter, type TutorialChapter } from '../data/tutorial';
import { normalizePracticeRecords, type PracticeRecords } from './practice-records';
import { isObject } from './save-settings';

export interface SaveRecords {
  defenseWaves: Record<string, number>;
  raidBestMs: Record<string, number>;
  practice: PracticeRecords;
  tutorial: TutorialChapter[];
}

export function defaultRecords(): SaveRecords {
  return { defenseWaves: {}, raidBestMs: {}, practice: {}, tutorial: [] };
}

/** 防衛戦の波を記録する（多いときだけ）。変わったら true */
export function recordDefenseWaves(r: SaveRecords, key: string, waves: number): boolean {
  const w = Math.floor(waves);
  if (!Number.isFinite(w) || w < 0) return false;
  const prev = r.defenseWaves[key];
  if (prev !== undefined && prev >= w) return false;
  r.defenseWaves[key] = Math.min(w, DEFENSE_CONFIG.waves);
  return true;
}

/** レイドの撃破までの時間を記録する（速いときだけ）。変わったら true */
export function recordRaidTime(r: SaveRecords, key: string, ms: number): boolean {
  const t = Math.round(ms);
  if (!Number.isFinite(t) || t <= 0) return false;
  const prev = r.raidBestMs[key];
  if (prev !== undefined && prev <= t) return false;
  r.raidBestMs[key] = t;
  return true;
}

/** 全マップ・難易度の中の最高波（記録なしは null） */
export function bestDefenseWaves(r: Readonly<SaveRecords>): number | null {
  const v = Object.values(r.defenseWaves);
  return v.length > 0 ? Math.max(...v) : null;
}

/**
 * 全難易度の中の最速（ミリ秒。記録なしは null）。9-6c: 怪獣ごと（キーが「怪獣:難易度」。ヴォルガスは難易度だけ）
 */
export function bestRaidMs(
  r: Readonly<SaveRecords>,
  kaiju: RaidKaijuId = VORGAS_ID,
): number | null {
  const v = Object.entries(r.raidBestMs)
    .filter(([key]) => raidKaijuOfKey(key) === kaiju)
    .map(([, ms]) => ms);
  return v.length > 0 ? Math.min(...v) : null;
}

/** 読み込んだ値を確かめる（壊れた項目は捨てる） */
export function normalizeRecords(raw: unknown): SaveRecords {
  const out = defaultRecords();
  if (!isObject(raw)) return out;
  const pick = (src: unknown, dst: Record<string, number>, ok: (n: number) => boolean): void => {
    if (!isObject(src)) return;
    for (const [k, v] of Object.entries(src))
      if (typeof v === 'number' && Number.isFinite(v) && ok(v)) dst[k] = v;
  };
  pick(raw.defenseWaves, out.defenseWaves, (n) => n >= 0 && n <= DEFENSE_CONFIG.waves);
  pick(raw.raidBestMs, out.raidBestMs, (n) => n > 0);
  out.practice = normalizePracticeRecords(raw.practice);
  if (Array.isArray(raw.tutorial))
    for (const c of raw.tutorial)
      if (isTutorialChapter(c) && !out.tutorial.includes(c)) out.tutorial.push(c);
  return out;
}
