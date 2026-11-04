// 練習場（9-5）の表示の文: 記録の設定の見出し・割合・秒
import { formatDecimal } from '../core/format';
import { t } from '../core/i18n';
import { AIM_ASSIST_LEVEL_LABELS } from '../data/assist';
import { PRACTICE_CONFIG } from '../data/practice';
import { STEER_LABELS } from '../data/steer';
import type { MissionResult } from '../missions/runner';
import { parsePracticeSettings } from '../progression/practice-records';
import { curveLabel } from './control-settings';

/** 設定の見出し（「タッチ・方向へ倒す・補助 標準・自動射撃 ON・カーブ 1.5」「キーボード」）。読めなければそのまま */
export function practiceSettingsLabel(key: string): string {
  const s = parsePracticeSettings(key);
  if (!s) return key;
  const device = t(`practice.device.${s.device}`);
  const c = s.touch;
  if (!c) return device;
  const assist =
    c.aimAssist === 'off' ? t('practice.assistOff') : AIM_ASSIST_LEVEL_LABELS.levels[c.aimAssist];
  return [
    device,
    STEER_LABELS.modes[c.steerMode],
    t('practice.assistShort', { level: assist }),
    t(c.autoFire ? 'practice.autoFireOn' : 'practice.autoFireOff'),
    t('practice.curveShort', { curve: curveLabel(c.curve) }),
  ].join(t('practice.separator'));
}

/** 0〜1 の割合 → 「12.3%」（null は —） */
export function formatRatio(v: number | null): string {
  return v === null ? '—' : `${formatDecimal(v * 100, 1)}%`;
}

/** 秒 → 「8.5 秒」（null は —） */
export function formatSeconds(v: number | null): string {
  return v === null ? '—' : t('practice.seconds', { seconds: formatDecimal(v, 1) });
}

/** 練習場への案内（9-5）: チュートリアルの完了、M1・M2 の失敗（狙いの練習が要りそうなとき） */
export function practiceHintFor(
  tutorial: boolean,
  r: Pick<MissionResult, 'outcome' | 'missionId'>,
): 'tutorial' | 'failed' | undefined {
  if (tutorial) return r.outcome === 'success' ? 'tutorial' : undefined;
  const ids: readonly string[] = PRACTICE_CONFIG.guideMissions;
  return r.outcome === 'failed' && ids.includes(r.missionId) ? 'failed' : undefined;
}
