// 9-7: M8「決戦」（ネフィルガのキャンペーン版）の演出（ネフィルガの遅延チャンク）: 登場・段階の変わり目・撃破で、画面の中央に大きな文字
// （紫白の稲光のような縁取り）と咆哮、画面全体の白い閃光（稲光）を出し、天候を移す（嵐の段階で雨・撃破で夕方の晴れ間。
// 3 秒の補間は 7-5 の天候のまま）。描画フレームごとに本体を見て、前の値と比べて決める（判定には触らないので、リプレイでも同じに出る）
import { FINALE_WEATHER } from '../data/weather';
import { k2t } from '../data/kaiju2-text';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import { el } from './hud-dom';

/** 大きな文字を出す秒数（登場は長め） */
const BANNER_SECONDS = { entrance: 4, phase: 3, defeat: 4 } as const;

export interface FinaleHooks {
  /** 天候を移す（src/render/weather の set。3 秒で補間） */
  readonly weather: (id: string) => void;
  /** 咆哮（距離によらず大きく） */
  readonly roar: () => void;
}

export class Kaiju2Finale {
  private readonly root: HTMLDivElement;
  private readonly main: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private remaining = 0;
  /** 見ているレイド（新しく始まったら登場から）と、前のフレームの段階・撃破 */
  private elapsed = Infinity;
  private phase = 0;
  private dead = false;

  constructor(
    parent: HTMLElement,
    private readonly hooks: FinaleHooks,
  ) {
    this.root = el('div', 'kaiju2-finale', parent);
    this.main = el('div', 'kaiju2-finale-main', this.root);
    this.sub = el('div', 'kaiju2-finale-sub', this.root);
    this.flash = el('div', 'kaiju2-finale-flash', parent);
    this.root.hidden = true;
    this.flash.hidden = true;
  }

  /** 描画フレームごと。raid はキャンペーン版を飛んでいるときだけ（それ以外は null）。flying は飛行中（ポーズ・結果では隠す） */
  update(raid: Kaiju2Raid | null, flying: boolean, dt: number): void {
    if (!raid) {
      this.elapsed = Infinity;
      this.hide();
      return;
    }
    const k = raid.body;
    // 新しく始まった（やり直し・再生のシークで戻った）: 登場から
    if (raid.elapsed < this.elapsed) {
      this.phase = k.phase;
      this.dead = raid.dead;
      if (raid.elapsed < 1) this.show('entrance', true);
    }
    this.elapsed = raid.elapsed;
    if (k.phase > this.phase && !raid.dead) {
      this.show(k.phase >= 3 ? 'phase3' : 'phase2', true);
      if (k.phase >= 3) this.hooks.weather(FINALE_WEATHER.storm);
    }
    this.phase = k.phase;
    if (raid.dead && !this.dead) {
      this.show('defeat', false);
      this.hooks.weather(FINALE_WEATHER.cleared);
    }
    this.dead = raid.dead;
    if (flying) this.remaining = Math.max(0, this.remaining - dt);
    this.root.hidden = !flying || this.remaining <= 0;
    if (!flying) this.flash.hidden = true;
  }

  private show(key: 'entrance' | 'phase2' | 'phase3' | 'defeat', roar: boolean): void {
    this.main.textContent = k2t(`finale.${key}`);
    this.sub.textContent = k2t(`finale.${key}Sub`);
    this.root.classList.toggle('is-defeat', key === 'defeat');
    // 文字のアニメーションを始めからやり直す
    this.root.hidden = true;
    this.root.getBoundingClientRect();
    this.root.hidden = false;
    this.remaining =
      key === 'entrance'
        ? BANNER_SECONDS.entrance
        : key === 'defeat'
          ? BANNER_SECONDS.defeat
          : BANNER_SECONDS.phase;
    if (roar) this.hooks.roar();
    if (key !== 'defeat') {
      this.flash.hidden = true;
      this.flash.getBoundingClientRect();
      this.flash.hidden = false;
    }
  }

  private hide(): void {
    this.remaining = 0;
    this.root.hidden = true;
    this.flash.hidden = true;
  }
}
