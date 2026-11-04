// モード選択のカードに小さく出す進捗（7-D。Three.js・DOM 非依存）: キャンペーンのクリア数・レースのランクの数・
// 防衛戦の最高波・レイドの最速・練習場（9-5）の課題ごとの最高スコア。記録がなければ出さない（キャンペーンは 0/5 を出す）
import { NEPHIRGA_ID } from '../data/raid-kaiju';
import { t } from '../core/i18n';
import { PRACTICE_DRILLS } from '../data/practice';
import { RANKS } from '../data/ranking';
import { practiceEntries } from './practice-records';
import type { SaveData } from './save';
import { bestDefenseWaves, bestRaidMs } from './save-records';

export type ProgressMode = 'campaign' | 'race' | 'defense' | 'raid' | 'practice';

/** 分:秒（1 時間を超えても分で数える） */
export function formatMinutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function modeProgress(
  save: Readonly<SaveData>,
  missionIds: readonly string[],
): Partial<Record<ProgressMode, string>> {
  const out: Partial<Record<ProgressMode, string>> = {};
  const cleared = missionIds.filter((id) => (save.missions[id]?.bestRank ?? null) !== null).length;
  out.campaign = t('progress.campaign', { cleared, total: missionIds.length });
  const counts = new Map<string, number>();
  for (const r of Object.values(save.races))
    if (r.bestRank) counts.set(r.bestRank, (counts.get(r.bestRank) ?? 0) + 1);
  const ranks = RANKS.filter((r) => counts.has(r)).map((r) => `${r}×${counts.get(r) ?? 0}`);
  if (ranks.length > 0) out.race = ranks.join(t('progress.separator'));
  const waves = bestDefenseWaves(save.records);
  if (waves !== null) out.defense = t('progress.defense', { waves });
  // 9-6c: ネフィルガの記録があれば怪獣ごとに（ヴォルガスだけなら今までどおり）
  const raid = bestRaidMs(save.records);
  const raid2 = bestRaidMs(save.records, NEPHIRGA_ID);
  if (raid2 !== null)
    out.raid = t('progress.raidBoth', {
      vorgas: raid === null ? '—' : formatMinutes(raid),
      nephirga: formatMinutes(raid2),
    });
  else if (raid !== null) out.raid = t('progress.raid', { time: formatMinutes(raid) });
  // 9-5: 課題ごとの最高（記録の無い課題は —）。どれも無ければ出さない
  const bests = PRACTICE_DRILLS.map((d) => practiceEntries(save.records.practice, d)[0]?.score);
  if (bests.some((b) => b !== undefined))
    out.practice = t('progress.practice', {
      scores: bests.map((b) => (b === undefined ? '—' : String(b))).join(' / '),
    });
  return out;
}
