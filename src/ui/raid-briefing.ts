// 協力レイドの開始前のブリーフィング（6-6）: カウントダウンの前の 5 秒、怪獣の弱点と「ブレイクは 2 人で同じ部位」の
// ヒントを出す。2 回目以降（前に最後まで見た）はスキップを押せる（全員が押すとホストが早く終わらせる）
import { t } from '../core/i18n';
import type { BuildingField } from '../combat/buildings';
import { RAID_BRIEFING } from '../data/raid';
import type { SaveStore } from '../progression/save-store';
import { el } from './hud-dom';
import { createButton } from './screen';

export class RaidBriefing {
  private readonly root: HTMLDivElement;
  private readonly remain: HTMLSpanElement;
  private readonly skip: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private lastText = '';
  private pressed = false;

  constructor(parent: HTMLElement, onSkip: () => void) {
    this.root = el('div', 'ui-dialog raid-briefing', parent);
    const head = el('div', 'campaign-label', this.root, RAID_BRIEFING.title);
    this.remain = el('span', 'raid-briefing-remain', head);
    this.list = el('ul', 'briefing-text raid-briefing-lines', this.root);
    this.fill(false);
    this.skip = createButton(
      this.root,
      'ui-button raid-briefing-skip',
      t('raid.briefing.skip'),
      () => {
        this.pressed = true;
        this.skip.disabled = true;
        this.skip.textContent = t('raid.briefing.waitingSkip');
        onSkip();
      },
    );
    this.root.hidden = true;
  }

  /** 描画フレームごと。remaining が 0 なら隠す。canSkip は 2 回目以降 */
  update(remaining: number, canSkip: boolean): void {
    this.root.hidden = remaining <= 0;
    if (remaining <= 0) return;
    const text = `  ${Math.ceil(remaining)}`;
    if (text !== this.lastText) {
      this.lastText = text;
      this.remain.textContent = text;
    }
    this.skip.hidden = !canSkip;
  }

  /** 難易度の文で埋める（8-6c: 高難度だけ「ダウン中はダメージ 2 倍」） */
  private fill(hard: boolean): void {
    this.list.replaceChildren();
    for (const line of RAID_BRIEFING.linesFor(hard)) el('li', '', this.list, line);
  }

  /** 新しい飛行の始め。hard は高難度 */
  reset(hard = false): void {
    this.fill(hard);
    this.pressed = false;
    this.skip.disabled = false;
    this.skip.textContent = t('raid.briefing.skip');
    this.root.hidden = true;
  }

  get skipped(): boolean {
    return this.pressed;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** 協力レイドが main から受け取るもの（6-6）: 街の建物・報酬の加算・ブリーフィングを見た印（セーブ） */
export function raidLinkDeps(save: SaveStore, buildings: () => BuildingField | null) {
  return {
    buildings,
    addCredits: (credits: number): void => {
      save.addCredits(credits);
    },
    briefingSeen: (): boolean => save.flag('raidBriefing'),
    markBriefingSeen: (): void => {
      save.setFlag('raidBriefing');
    },
  };
}
