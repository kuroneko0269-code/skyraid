// 10-4b: メカ怪獣ゴウライのレイドのブリーフィング（ゴウライの遅延チャンク。ネフィルガの kaiju2-briefing.ts と同じ形）: 出撃の直後に、
// 動き・体の当たり・弾幕と砲台・熱と核・後半を画面の下に briefingSeconds 秒出す。タップで閉じる。ポーズ・結果の画面では隠し、残りは飛行中だけ減る
import { GOURAI_RAID_CONFIG } from '../data/gourai-raid';
import { grlist, grt } from '../data/gourai-text';
import { RAID_DIFFICULTY_LABELS, type RaidDifficulty } from '../data/raid';
import { el } from './hud-dom';

export class GouraiBriefing {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private remaining = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ui-dialog gourai-briefing', parent);
    this.title = el('div', 'campaign-label', this.root);
    this.list = el('ul', 'briefing-text gourai-briefing-lines', this.root);
    el('div', 'gourai-briefing-tap', this.root, grt('briefingTap'));
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.remaining = 0;
      this.root.hidden = true;
    });
    this.root.hidden = true;
  }

  show(difficulty: RaidDifficulty): void {
    this.title.textContent = `${grt('briefingTitle')}  ${RAID_DIFFICULTY_LABELS[difficulty]}`;
    this.list.replaceChildren();
    for (const line of grlist('briefing')) el('li', '', this.list, line);
    this.remaining = GOURAI_RAID_CONFIG.briefingSeconds;
  }

  /** 描画フレームごと。flying の間だけ残りを減らして出す */
  update(dt: number, flying: boolean): void {
    if (flying) this.remaining = Math.max(0, this.remaining - dt);
    this.root.hidden = !flying || this.remaining <= 0;
  }
}
