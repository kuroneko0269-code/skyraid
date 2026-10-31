// 協力レイドの役割分担の HUD（6-6。kaiju-hud.ts の下に付ける）: 部位ごとの小さな HP バーと、その部位をロックしている
// 他プレイヤーの色の印（同じ部位を 2 人で撃つとブレイク）、自分が怪獣の攻撃の対象のときの「TARGET」。
// ブレイクの貢献者の名前は kaiju-hud.ts の BREAK! の行に出す。DOM は最初に作り、値が変わったときだけ書く
import { KAIJU_CONFIG, KAIJU_PARTS } from '../data/kaiju';
import type { KaijuPartView } from '../entities/kaiju-display';
import { el } from './hud-dom';

/** 1 フレーム分の協力の表示の値 */
export interface KaijuCoopFrame {
  /** 部位ごと（KAIJU_PARTS の順）に、ロックしている他プレイヤーの色（CSS） */
  readonly marks: readonly (readonly string[])[];
  /** 自分がロックしている部位の番号（-1 はなし） */
  readonly ownPart: number;
  /** 自分が怪獣の攻撃の対象か */
  readonly targeted: boolean;
  /** 直近のブレイクの貢献者の名前（「A + B」。なければ空） */
  readonly breakBy: string;
}

interface Chip {
  readonly root: HTMLDivElement;
  readonly fill: HTMLDivElement;
  readonly marks: HTMLSpanElement;
  lastHp: number;
  lastMarks: string;
}

export class KaijuCoopHud {
  readonly root: HTMLDivElement;
  private readonly chips: Chip[];
  private readonly target: HTMLDivElement;
  private lastOwn = -2;
  private lastTarget = false;

  constructor(parent: HTMLElement, overlay: HTMLElement) {
    this.root = el('div', 'kaiju-coop', parent);
    this.chips = KAIJU_PARTS.map((id) => {
      const root = el('div', 'kaiju-coop-part', this.root);
      el('span', 'kaiju-coop-name', root, KAIJU_CONFIG.parts[id].label);
      const bar = el('div', 'kaiju-coop-bar', root);
      const fill = el('div', 'kaiju-coop-fill', bar);
      const marks = el('span', 'kaiju-coop-marks', root);
      return { root, fill, marks, lastHp: NaN, lastMarks: '' };
    });
    this.target = el('div', 'kaiju-target', overlay, 'TARGET  怪獣があなたを狙っています');
    this.target.hidden = true;
    this.root.hidden = true;
  }

  update(parts: readonly KaijuPartView[], f: Readonly<KaijuCoopFrame> | null): void {
    this.root.hidden = f === null;
    const targeted = f?.targeted ?? false;
    if (targeted !== this.lastTarget) {
      this.lastTarget = targeted;
      this.target.hidden = !targeted;
    }
    if (!f) return;
    this.chips.forEach((c, i) => {
      const p = parts[i];
      const hp = p ? Math.max(0, p.hp / p.maxHp) : 0;
      if (hp !== c.lastHp) {
        c.lastHp = hp;
        c.fill.style.transform = `scaleX(${hp.toFixed(3)})`;
        c.root.classList.toggle('is-broken', hp <= 0);
      }
      const colors = f.marks[i] ?? [];
      const key = colors.join(',');
      if (key !== c.lastMarks) {
        c.lastMarks = key;
        c.marks.replaceChildren();
        for (const color of colors) {
          const dot = el('span', 'kaiju-coop-mark', c.marks, '●');
          dot.style.color = color;
        }
      }
    });
    if (f.ownPart !== this.lastOwn) {
      this.lastOwn = f.ownPart;
      this.chips.forEach((c, i) => c.root.classList.toggle('is-own', i === f.ownPart));
    }
  }

  hide(): void {
    this.root.hidden = true;
    this.target.hidden = true;
    this.lastTarget = false;
  }
}
