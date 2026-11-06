// 練習場（9-5）の表示の文: 記録の設定の見出し・割合・秒
import { formatDecimal } from '../core/format';
import { t } from '../core/i18n';
import { AIM_ASSIST_LEVEL_LABELS } from '../data/assist';
import { PRACTICE_CONFIG } from '../data/practice';
import { tutorialChapterOf } from '../data/tutorial';
import { STEER_LABELS } from '../data/steer';
import type { MissionResult } from '../missions/runner';
import { parsePracticeSettings } from '../progression/practice-records';
import { curveLabel } from './control-settings';
import { assistPresetOf } from '../core/assist-preset';
import { assistPresetName } from './assist-preset';

/**
 * 設定の見出し（「タッチ・方向へ倒す・補助 標準・自動射撃 ON・カーブ 1.5」「キーボード」）。読めなければそのまま。
 * short（9-5d: 練習場の一覧の狭い欄）: 補助の 3 つが補助の組と同じなら組の名前にまとめる（「タッチ・方向へ倒す・かんたん・カーブ 1.5」）
 */
export function practiceSettingsLabel(key: string, short = false): string {
  const s = parsePracticeSettings(key);
  if (!s) return key;
  const device = t(`practice.device.${s.device}`);
  const c = s.touch;
  if (!c) return device;
  const preset =
    c.aimAssist === 'off' ? 'custom' : assistPresetOf({ ...c, aimAssist: c.aimAssist });
  if (short && preset !== 'custom')
    return [
      device,
      STEER_LABELS.modes[c.steerMode],
      assistPresetName(preset),
      t('practice.curveShort', { curve: curveLabel(c.curve) }),
    ].join(t('practice.separator'));
  const assist =
    c.aimAssist === 'off' ? t('practice.assistOff') : AIM_ASSIST_LEVEL_LABELS.levels[c.aimAssist];
  return [
    device,
    STEER_LABELS.modes[c.steerMode],
    t('practice.assistShort', { level: assist }),
    t(c.autoFire ? 'practice.autoFireOn' : 'practice.autoFireOff'),
    t('practice.curveShort', { curve: curveLabel(c.curve) }),
    t(c.speedMatch ? 'practice.speedMatchOn' : 'practice.speedMatchOff'),
  ].join(t('practice.separator'));
}

/** 0〜1 の割合 → 「12.3%」（null は —） */
export function formatRatio(v: number | null): string {
  return v === null ? '—' : `${formatDecimal(v * 100, 1)}%`;
}

/** 練習場への案内（9-5）: チュートリアル（9-5c: 狙いの章・最後に飛ぶ章）の完了、M1・M2 の失敗（狙いの練習が要りそうなとき） */
export function practiceHintFor(
  tutorial: boolean,
  r: Pick<MissionResult, 'outcome' | 'missionId'>,
): 'tutorial' | 'failed' | undefined {
  if (tutorial) {
    const c = tutorialChapterOf(r.missionId);
    const aim = c === 'gun' || c === 'moving' || c === 'find';
    return r.outcome === 'success' && aim ? 'tutorial' : undefined;
  }
  const ids: readonly string[] = PRACTICE_CONFIG.guideMissions;
  return r.outcome === 'failed' && ids.includes(r.missionId) ? 'failed' : undefined;
}
