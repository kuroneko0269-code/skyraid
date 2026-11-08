// チュートリアルとタッチ操作のヒント（4-11）の配線: 指示の HUD・タッチの部品の発光・初回だけの報酬・
// フリーフライト / ミッションの初回のヒント。main から飛行の開始・ランナーの変化・描画フレームで呼ぶ
import { buildKeyBindings, keyLabel } from '../core/control-settings';
import type { Input } from '../core/input';
import type { MissionRunner } from '../missions/runner';
import type { TutorialCoach } from '../missions/tutorial/coach';
import type { SaveStore } from '../progression/save-store';
import { bindTutorialReward, type TutorialReward } from '../progression/tutorial-reward';
import type { Hud } from './hud';
import type { TouchLink } from './touch-link';
import { TouchHints } from './touch-hints';
import { TutorialHud } from './tutorial-hud';
import { tutorialStrings } from './tutorial-text';
import { showToast } from './toast';
import { t } from '../core/i18n';
import { STEER_DEFAULTS } from '../data/steer';
import { markSteerNoticeForNewPilot, takeSteerNotice } from '../progression/steer-notice';

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
    this.hud = new TutorialHud(
      parent,
      // 指示の文のキー名は今の割当（4-11 の操作設定）
      (a) => {
        const code = buildKeyBindings(save.settings.controls.keys)[a][0];
        return code === undefined ? '—' : keyLabel(code);
      },
      (parts) => {
        touch.controls.highlight(parts);
      },
      onAbort,
      // 9-4: 効いている方式（傾きの許可を待つ間は「方向へ倒す」）
      () => touch.controls.mode,
    );
    this.hints = new TouchHints(parent, gameHud.root, tutorialStrings().hints);
    // 9-2: 初回起動の人（名前がまだ）は新しい操作から始めるので、「操作方法が新しくなりました」は出さない
    markSteerNoticeForNewPilot(save);
  }

  /** この章で払ったクレジット（リザルト。飛ぶ章をすべて終えた初回だけ 500） */
  get paid(): number {
    return this.reward?.paid ?? 0;
  }

  /** ランナーが変わったとき（coach: チュートリアルの章の進行役。チュートリアルでなければ null） */
  attach(runner: MissionRunner | null, coach: TutorialCoach | null): void {
    this.reward?.off();
    this.reward = null;
    this.hud.attach(coach ? runner : null, coach);
    if (runner && coach) this.reward = bindTutorialReward(runner.bus, this.save, coach.chapter);
  }

  /**
   * 飛行を始めたとき（タッチ操作の表示を決めた後）。タッチ操作が出ていれば、フリーフライト・ミッションの
   * それぞれ初回だけヒントを出す（チュートリアルは指示があるので出さない）
   */
  onFlightStart(kind: 'free' | 'mission' | 'tutorial'): void {
    this.hints.stop();
    if (kind !== 'tutorial') this.weaponNotice();
    if (kind === 'tutorial' || !this.touch.controls.isVisible) return;
    // 9-2: 今の利用者に一度だけ（タッチ操作を出した最初の飛行の始め）
    if (takeSteerNotice(this.save))
      showToast(t('controls.steer.notice'), { seconds: STEER_DEFAULTS.noticeSeconds });
    const flag = kind === 'free' ? 'hintsFree' : 'hintsMission';
    if (this.save.flag(flag)) return;
    this.save.setFlag(flag);
    this.hints.start();
  }

  /** 10-4b: 今の入力の方式（タッチ操作が出ていてパッドを触っていなければタッチ） */
  private device(): 'touch' | 'keys' | 'pad' {
    const d = this.input.lastDevice;
    if (d === 'gamepad') return 'pad';
    return d === 'touch' || this.touch.controls.isVisible ? 'touch' : 'keys';
  }

  /** 10-4b: ロケット・爆弾の撃ち方の文（{rocket} {bomb} は今の割当のキー） */
  private weaponText(key: 'hud.weaponHint' | 'tutorial.weaponHint'): string {
    const keys = buildKeyBindings(this.save.settings.controls.keys);
    const name = (a: 'rocket' | 'bomb'): string => {
      const code = keys[a][0];
      return code === undefined ? '—' : keyLabel(code);
    };
    return t(`${key}.${this.device()}`, { rocket: name('rocket'), bomb: name('bomb') });
  }

  /** 10-4b: HUD の残弾の列の下の小さな印 */
  weaponHint(): string {
    return this.weaponText('hud.weaponHint');
  }

  /** 10-4b: チュートリアルの外の最初の飛行の始めに 1 回だけ、ロケット・爆弾の撃ち方を知らせる */
  private weaponNotice(): void {
    if (this.save.flag('weaponHint')) return;
    this.save.setFlag('weaponHint');
    showToast(this.weaponText('tutorial.weaponHint'), { seconds: 6 });
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
    this.hud.update(touch ? 'touch' : device, dt);
    if (this.hints.running) this.hints.update(dt);
  }
}
