// 怪獣の HUD（6-2）: 画面上部に怪獣の全体 HP バーとフェーズ（最終フェーズは残り時間）、ロック中の部位名と部位 HP、
// 攻撃の予兆の警告（攻撃名と残り秒）、ダウン、BREAK!、咆哮のスタン中のノイズ。値は描画フレームごとに update で渡す。
// DOM は最初に作り、値が変わったときだけ書く
import './kaiju-hud.css';
import { KAIJU_ATTACK_CONFIG, KAIJU_CONFIG } from '../data/kaiju';
import type { KaijuBodyView, KaijuPartView } from '../entities/kaiju-display';
import { el } from './hud-dom';
import { formatClock } from './mission-text';
import { KaijuCoopHud, type KaijuCoopFrame } from './kaiju-coop-hud';

/** 1 フレーム分の表示の値 */
export interface KaijuHudFrame {
  /** 出ていなければ null（HUD を隠す） */
  readonly body: KaijuBodyView | null;
  /** ロック（選択）中の部位 */
  readonly locked: KaijuPartView | null;
  /** 自機のスタンの残り秒数 */
  readonly stun: number;
  /** 協力レイドの役割分担（6-6。ソロは省略） */
  readonly coop?: KaijuCoopFrame | null;
}

export class KaijuHud {
  readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly phase: HTMLSpanElement;
  private readonly partRow: HTMLDivElement;
  private readonly partName: HTMLSpanElement;
  private readonly partFill: HTMLDivElement;
  private readonly warning: HTMLDivElement;
  private readonly breakText: HTMLDivElement;
  private readonly down: HTMLDivElement;
  private readonly noise: HTMLDivElement;
  private readonly coop: KaijuCoopHud;
  private shown = true;
  private last = {
    hp: NaN,
    phase: '',
    part: '',
    partHp: NaN,
    warn: '',
    brk: '',
    down: '',
    stun: false,
    visible: false,
  };

  constructor(parent: HTMLElement) {
    const root = el('div', 'kaiju-hud', parent);
    this.root = root;
    const top = el('div', 'kaiju-top', root);
    const head = el('div', 'kaiju-head', top);
    el('span', 'kaiju-name', head, `${KAIJU_CONFIG.name}  VORGAS`);
    this.phase = el('span', 'kaiju-phase', head);
    const bar = el('div', 'kaiju-bar', top);
    this.fill = el('div', 'kaiju-bar-fill', bar);
    // フェーズの境目の目盛り
    for (const r of [KAIJU_CONFIG.phases.phase2Ratio, KAIJU_CONFIG.phases.phase3Ratio]) {
      const tick = el('div', 'kaiju-bar-tick', bar);
      tick.style.left = `${r * 100}%`;
    }
    this.partRow = el('div', 'kaiju-part', top);
    this.partName = el('span', 'kaiju-part-name', this.partRow);
    const pbar = el('div', 'kaiju-part-bar', this.partRow);
    this.partFill = el('div', 'kaiju-part-fill', pbar);
    this.coop = new KaijuCoopHud(top, root);
    this.warning = el('div', 'kaiju-warning', root);
    this.breakText = el('div', 'kaiju-break', root, 'BREAK!');
    this.down = el('div', 'kaiju-down', root);
    this.noise = el('div', 'kaiju-noise', root);
    this.warning.hidden = true;
    this.breakText.hidden = true;
    this.down.hidden = true;
    this.partRow.hidden = true;
    this.root.hidden = true;
  }

  /** HUD の表示切替（H キー。4-1 の HUD の切替に合わせる） */
  setShown(shown: boolean): void {
    this.shown = shown;
  }

  update(f: Readonly<KaijuHudFrame>): void {
    this.setStun(f.stun > 0);
    const b = f.body;
    const visible = this.shown && b !== null && b.visible && b.hp > 0;
    if (visible !== this.last.visible) {
      this.last.visible = visible;
      this.root.hidden = !visible;
    }
    if (b === null || !visible) return;
    const ratio = Math.max(0, b.hp / b.maxHp);
    if (ratio !== this.last.hp) {
      this.last.hp = ratio;
      this.fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }
    const phase =
      b.finalRemaining !== null
        ? `最終フェーズ  ${formatClock(b.finalRemaining)}`
        : `PHASE ${b.phase}`;
    if (phase !== this.last.phase) {
      this.last.phase = phase;
      this.phase.textContent = phase;
      this.phase.classList.toggle('is-final', b.finalRemaining !== null);
    }
    this.setPart(f.locked);
    this.coop.update(b.parts, f.coop ?? null);
    // 予兆: 攻撃名と残り秒
    const warn =
      b.attack && b.attackStep === 'windup'
        ? `⚠ ${KAIJU_ATTACK_CONFIG[b.attack].label}  ${Math.max(0, b.attackDuration - b.attackTime).toFixed(1)}`
        : '';
    if (warn !== this.last.warn) {
      this.last.warn = warn;
      this.warning.textContent = warn;
      this.warning.hidden = warn === '';
    }
    let brk = '';
    for (const p of b.parts)
      if (p.breakTimer > 0) brk = `BREAK!  ${p.label} ×${KAIJU_CONFIG.break.damageScale}`;
    // 6-6: 協力はブレイクの貢献者の名前を下に
    const by = brk !== '' ? (f.coop?.breakBy ?? '') : '';
    if (brk + by !== this.last.brk) {
      this.last.brk = brk + by;
      this.breakText.textContent = brk;
      if (by !== '') el('span', 'kaiju-break-by', this.breakText, by);
      this.breakText.hidden = brk === '';
    }
    const down =
      b.downTimer > 0
        ? `DOWN  ${Math.ceil(b.downTimer)}  ダメージ ×${KAIJU_CONFIG.down.damageScale}`
        : '';
    if (down !== this.last.down) {
      this.last.down = down;
      this.down.textContent = down;
      this.down.hidden = down === '';
    }
  }

  private setPart(p: KaijuPartView | null): void {
    const name = p ? `${p.label}${p.broken ? '（破壊）' : ''}` : '';
    if (name !== this.last.part) {
      this.last.part = name;
      this.partName.textContent = name;
      this.partRow.hidden = name === '';
      this.partRow.classList.toggle('is-broken', p?.broken ?? false);
    }
    const hp = p ? Math.max(0, p.hp / p.maxHp) : 0;
    if (hp !== this.last.partHp) {
      this.last.partHp = hp;
      this.partFill.style.transform = `scaleX(${hp.toFixed(4)})`;
    }
  }

  private setStun(on: boolean): void {
    if (on === this.last.stun) return;
    this.last.stun = on;
    this.noise.classList.toggle('is-on', on);
    document.documentElement.toggleAttribute('data-stunned', on);
  }

  hide(): void {
    this.coop.hide();
    this.root.hidden = true;
    this.last.visible = false;
    this.setStun(false);
  }
}
