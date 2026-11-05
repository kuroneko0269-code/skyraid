// 補助の組（9-5d。DOM・Three.js 非依存）: 狙いの補助・自動射撃・速度合わせの 3 つの値から今の組（かんたん / ふつう / むずかしい /
// カスタム）を読み、組を選んだら 3 つを書き換える。組そのものは保存しない（個別の設定を変えると自然に「カスタム」になる）。
// キーボード・パッド・PvP の部屋の補正はこの 3 つを使わないので変わらない
import {
  ASSIST_PRESET_VALUES,
  ASSIST_PRESETS,
  type AssistPreset,
  type AssistPresetValues,
} from '../data/assist';

export type AssistPresetState = AssistPreset | 'custom';

/** 今の値の組（どの組とも違えば custom） */
export function assistPresetOf(c: Readonly<AssistPresetValues>): AssistPresetState {
  for (const p of ASSIST_PRESETS) {
    const v = ASSIST_PRESET_VALUES[p];
    if (v.aimAssist === c.aimAssist && v.autoFire === c.autoFire && v.speedMatch === c.speedMatch)
      return p;
  }
  return 'custom';
}

/** 組の値を書く（ほかの設定には触れない） */
export function applyAssistPreset(
  c: { aimAssist: AssistPresetValues['aimAssist']; autoFire: boolean; speedMatch: boolean },
  p: AssistPreset,
): void {
  const v = ASSIST_PRESET_VALUES[p];
  c.aimAssist = v.aimAssist;
  c.autoFire = v.autoFire;
  c.speedMatch = v.speedMatch;
}

export function isAssistPreset(v: unknown): v is AssistPreset {
  return typeof v === 'string' && (ASSIST_PRESETS as readonly string[]).includes(v);
}
