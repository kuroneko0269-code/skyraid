// 被弾の赤いフラッシュ（薄く）と「撃墜された」の表示（2-3）。DOM は最初に作り、値が変わったときだけ書く
import './damage-overlay.css';
import { AIRCRAFT_COMBAT } from '../data/aircraft';
import { HUD_CONFIG } from '../data/hud';
import { el } from './hud-dom';
import { changed } from './hud-math';

export class DamageOverlay {
  private readonly flash: HTMLDivElement;
  private readonly shade: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly countdown: HTMLDivElement;
  private last = { opacity: NaN, down: false, seconds: '' };

  constructor(parent: HTMLElement) {
    this.shade = el('div', 'down-shade', parent);
    this.flash = el('div', 'damage-flash', parent);
    this.message = el('div', 'down-message', parent);
    el('div', 'down-message-main', this.message, '撃墜された');
    this.countdown = el('div', 'down-message-sub', this.message);
    this.shade.hidden = this.message.hidden = true;
  }

  /**
   * flashTimer: 被弾の赤の残り時間（秒）。respawnTimer: 撃墜中ならリスポーンまでの残り（秒）、生きていれば 0。
   * shown が false（飛行中でない）なら全部隠す
   */
  update(flashTimer: number, down: boolean, respawnTimer: number, shown: boolean): void {
    const last = this.last;
    const k = shown ? Math.min(1, flashTimer / AIRCRAFT_COMBAT.playerHitFlashSeconds) : 0;
    const opacity = k * HUD_CONFIG.damage.flashOpacity;
    if (changed(last.opacity, opacity, 0.005)) {
      last.opacity = opacity;
      this.flash.style.opacity = opacity.toFixed(3);
    }
    const isDown = shown && down;
    if (isDown !== last.down) {
      last.down = isDown;
      this.shade.hidden = this.message.hidden = !isDown;
    }
    if (!isDown) return;
    const seconds = `${Math.max(1, Math.ceil(respawnTimer))} 秒後に復帰`;
    if (seconds !== last.seconds) this.countdown.textContent = last.seconds = seconds;
  }
}
