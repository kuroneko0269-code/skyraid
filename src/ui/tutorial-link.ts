// チュートリアルとタッチ操作のヒント（4-11）の配線: 指示の HUD・タッチの部品の発光・初回だけの報酬・
// フリーフライト / ミッションの初回のヒント。main から飛行の開始・ランナーの変化・描画フレームで呼ぶ
import { buildKeyBindings, keyLabel } from '../core/control-settings';
import type { Input } from '../core/input';
import { detectLocale } from '../core/locale';
import type { MissionRunner } from '../missions/runner';
import type { SaveStore } from '../progression/save-store';
import { bindTutorialReward, type TutorialReward } from '../progression/tutorial-reward';
import type { Hud } from './hud';
import type { TouchLink } from './touch-link';
import { TouchHints } from './touch-hints';
import { TutorialHud } from './tutorial-hud';
import { tutorialStrings } from './tutorial-text';

export class TutorialLink {
  private readonly hud: TutorialHud;
  private readonly hints: TouchHints;
  private reward: TutorialReward | null = null;
  private lastMs: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly save: SaveStore,
    private readonly input: Input,
    private readonly touch: TouchLink,
    gameHud: Hud,
    onAbort: () => void,
  ) {
    const locale = detectLocale(window.location.search, navigator.languages);
    this.hud = new TutorialHud(
      parent,
      locale,
      // 指示の文のキー名は今の割当（4-11 の操作設定）
      (a) => {
        const code = buildKeyBindings(save.settings.controls.keys)[a][0];
        return code === undefined ? '—' : keyLabel(code);
      },
      (parts) => {
        touch.controls.highlight(parts);
      },
      onAbort,
    );
    this.hints = new TouchHints(parent, gameHud.root, tutorialStrings(locale).hints);
  }

  /** このチュートリアルで払ったクレジット（リザルト。初回だけ 500） */
  get paid(): number {
    return this.reward?.paid ?? 0;
  }

  /** ランナーが変わったとき（tutorial: チュートリアルのランナーか） */
  attach(runner: MissionRunner | null, tutorial: boolean): void {
    this.reward?.off();
    this.reward = null;
    this.hud.attach(tutorial ? runner : null);
    if (runner && tutorial) this.reward = bindTutorialReward(runner.bus, this.save);
  }

  /**
   * 飛行を始めたとき（タッチ操作の表示を決めた後）。タッチ操作が出ていれば、フリーフライト・ミッションの
   * それぞれ初回だけヒントを出す（チュートリアルは指示があるので出さない）
   */
  onFlightStart(kind: 'free' | 'mission' | 'tutorial'): void {
    this.hints.stop();
    if (kind === 'tutorial' || !this.touch.controls.isVisible) return;
    const flag = kind === 'free' ? 'hintsFree' : 'hintsMission';
    if (this.save.flag(flag)) return;
    this.save.setFlag(flag);
    this.hints.start();
  }

  /** 描画フレームごと。ヒントの時間は飛行中だけ進める */
  update(flying: boolean): void {
    const now = performance.now();
    const dt = this.lastMs === null ? 0 : Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    if (!flying) return;
    // タッチ操作が出ていて、まだパッドを触っていなければタッチの文（Input.lastDevice の初期値はキーボード）
    const device = this.input.lastDevice;
    const touch = this.touch.controls.isVisible && device === 'keyboard';
    this.hud.update(touch ? 'touch' : device);
    if (this.hints.running) this.hints.update(dt);
  }
}
