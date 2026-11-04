// 練習場（9-5）の設定の欄: 操縦（タッチ）の方式・狙いの補助・自動射撃・速度合わせ（9-5b）・感度のカーブを、課題の一覧・ポーズ・結果の画面からその場で変える。
// 値は設定画面の「操作」と同じ（セーブの settings.controls）。変えるとすぐ効かせ、設定画面とほかの欄の表示を合わせ直す（onChange）。
// 傾きは設定画面と同じ選択肢（使えない端末には出さない・iOS は許可のボタン）
import { t } from '../core/i18n';
import type { ControlSettings } from '../core/control-settings';
import { AIM_ASSIST_LEVEL_LABELS, AIM_ASSIST_LEVELS } from '../data/assist';
import { STEER_LABELS, STICK_CURVES } from '../data/steer';
import type { SaveStore } from '../progression/save-store';
import { choice, curveLabel } from './control-settings';
import { el } from './hud-dom';
import { createToggleButton } from './mobile';
import { createSteerModeChoice } from './tilt-settings';
import type { TiltSource } from './tilt-source';

export class PracticeSettingsPanel {
  readonly root: HTMLDivElement;
  private readonly syncers: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly save: SaveStore,
    tilt: TiltSource,
    /** 値を変えた後（効かせる・ほかの表示を合わせ直す） */
    onChange: () => void,
  ) {
    const root = el('div', 'practice-settings', parent);
    el('div', 'practice-settings-heading', root, t('practice.settings.heading'));
    const grid = el('div', 'control-settings-toggles practice-settings-grid', root);
    const c = save.settings.controls;
    const commit = (fn: (x: ControlSettings) => void): void => {
      save.updateControls(fn);
      onChange();
    };
    const steer = createSteerModeChoice(grid, c, tilt, (v) => {
      commit((x) => (x.steerMode = v));
    });
    this.syncers.push(() => {
      steer.sync(this.save.settings.controls.steerMode);
    });
    const assist = choice(
      grid,
      AIM_ASSIST_LEVEL_LABELS.title,
      AIM_ASSIST_LEVELS.map((v) => [v, AIM_ASSIST_LEVEL_LABELS.levels[v]] as const),
      c.aimAssist,
      (v) => {
        commit((x) => (x.aimAssist = v));
      },
    );
    const autoFire = createToggleButton(grid, AIM_ASSIST_LEVEL_LABELS.autoFire, c.autoFire, () => {
      commit((x) => (x.autoFire = !x.autoFire));
      return this.save.settings.controls.autoFire;
    });
    // 9-5b: 速度合わせ
    const speedMatch = createToggleButton(
      grid,
      AIM_ASSIST_LEVEL_LABELS.speedMatch,
      c.speedMatch,
      () => {
        commit((x) => (x.speedMatch = !x.speedMatch));
        return this.save.settings.controls.speedMatch;
      },
    );
    const curve = choice(
      grid,
      STEER_LABELS.curve,
      STICK_CURVES.map((v) => [v, curveLabel(v)] as const),
      c.stickCurve,
      (v) => {
        commit((x) => (x.stickCurve = v));
      },
    );
    this.syncers.push(() => {
      const now = this.save.settings.controls;
      assist.value = now.aimAssist;
      autoFire.sync(now.autoFire);
      speedMatch.sync(now.speedMatch);
      curve.value = String(now.stickCurve);
    });
    el('div', 'practice-settings-note', root, t('practice.settings.note'));
    this.root = root;
  }

  /** セーブの今の値に表示を合わせる（出すたび・ほかの欄で変えたとき） */
  sync(): void {
    for (const fn of this.syncers) fn();
  }
}
