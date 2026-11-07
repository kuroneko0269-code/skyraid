// 10-3b: 白鯨アルビオンのレイドのブリーフィング（アルビオンの遅延チャンク。ネフィルガの kaiju2-briefing.ts と同じ形）: 出撃の直後に、
// 周回・巣と子分・危ない所・弱点を画面の下に briefingSeconds 秒出す。タップで閉じる。ポーズ・結果の画面では隠し、残りは飛行中だけ減る
import { ALBION_RAID_CONFIG } from '../data/albion-raid';
import { ablist, abt } from '../data/albion-text';
import { RAID_DIFFICULTY_LABELS, type RaidDifficulty } from '../data/raid';
import { el } from './hud-dom';

export class AlbionBriefing {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private remaining = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ui-dialog albion-briefing', parent);
    this.title = el('div', 'campaign-label', this.root);
    this.list = el('ul', 'briefing-text albion-briefing-lines', this.root);
    el('div', 'albion-briefing-tap', this.root, abt('briefingTap'));
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.remaining = 0;
      this.root.hidden = true;
    });
    this.root.hidden = true;
  }

  show(difficulty: RaidDifficulty): void {
    this.title.textContent = `${abt('briefingTitle')}  ${RAID_DIFFICULTY_LABELS[difficulty]}`;
    this.list.replaceChildren();
    for (const line of ablist('briefing')) el('li', '', this.list, line);
    this.remaining = ALBION_RAID_CONFIG.briefingSeconds;
  }

  /** 描画フレームごと。flying の間だけ残りを減らして出す */
  update(dt: number, flying: boolean): void {
    if (flying) this.remaining = Math.max(0, this.remaining - dt);
    this.root.hidden = !flying || this.remaining <= 0;
  }
}
