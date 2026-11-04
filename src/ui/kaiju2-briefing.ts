// 9-6b: ネフィルガのレイドのブリーフィング（ネフィルガの遅延チャンク）: 出撃の直後に、予兆の読み方・攻めどき・部位・制限時間を
// 画面の下に briefingSeconds 秒出す（怪獣は遠くから来て、最初の攻撃は firstAttackDelay 秒後）。タップで閉じる。
// ポーズ・結果の画面では隠し、残りの秒数は飛行中だけ減る
import { KAIJU2_RAID_CONFIG } from '../data/kaiju2-raid';
import { k2list, k2t } from '../data/kaiju2-text';
import { RAID_DIFFICULTY_LABELS, type RaidDifficulty } from '../data/raid';
import { el } from './hud-dom';

export class Kaiju2Briefing {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private remaining = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ui-dialog kaiju2-briefing', parent);
    this.title = el('div', 'campaign-label', this.root);
    this.list = el('ul', 'briefing-text kaiju2-briefing-lines', this.root);
    el('div', 'kaiju2-briefing-tap', this.root, k2t('briefingTap'));
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.remaining = 0;
      this.root.hidden = true;
    });
    this.root.hidden = true;
  }

  show(difficulty: RaidDifficulty): void {
    this.title.textContent = `${k2t('briefingTitle')}  ${RAID_DIFFICULTY_LABELS[difficulty]}`;
    this.list.replaceChildren();
    for (const line of k2list('briefing')) el('li', '', this.list, line);
    this.remaining = KAIJU2_RAID_CONFIG.briefingSeconds;
  }

  /** 描画フレームごと。flying の間だけ残りを減らして出す */
  update(dt: number, flying: boolean): void {
    if (flying) this.remaining = Math.max(0, this.remaining - dt);
    this.root.hidden = !flying || this.remaining <= 0;
  }
}
