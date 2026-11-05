// PvP の飛行中の大きな表示（5-4）: 開始前のカウントダウン（3・2・1・GO）、残り時間の警告（30 秒・10 秒）、
// 撃墜されたときの画面（撃墜した相手の名前・復帰までのカウント）、復帰後の無敵と初心者保護の表示、再接続中の表示。
// 描画フレームごとに update を呼び、文字が変わったときだけ書き換える。文字は textContent だけで入れる
import { t } from '../core/i18n';
import { el } from './hud-dom';

export interface OverlayState {
  /** カウントダウンの残り秒数（0 は始まっている） */
  countdown: number;
  /** 「GO」を出している（始まった直後） */
  go: boolean;
  /** 残り時間の警告の文（空は出さない） */
  warning: string;
  /** 撃墜されている間: 撃墜した相手（null は墜落）と色、復帰までの秒数 */
  downed: { killer: string | null; color: string; remaining: number } | null;
  /** 復帰後の無敵の残り秒数 */
  invulnerable: number;
  /** 初心者保護つきの命 */
  boosted: boolean;
  /** つなぎ直しの残り秒数（null はつながっている） */
  reconnect: number | null;
  /** 9-6d: 協力レイドの残機（今の機体を含む。null は出さない）。撃墜中の remaining が負なら観戦（復帰しない） */
  lives?: number | null;
}

export class PvpOverlay {
  private readonly root: HTMLDivElement;
  private readonly count: HTMLDivElement;
  private readonly warning: HTMLDivElement;
  private readonly downed: HTMLDivElement;
  private readonly downedBy: HTMLDivElement;
  private readonly downedPre: HTMLSpanElement;
  private readonly downedKiller: HTMLSpanElement;
  private readonly downedVerb: HTMLSpanElement;
  private readonly downedCount: HTMLDivElement;
  private readonly downedLabel: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly reconnect: HTMLDivElement;
  private readonly last = new Map<string, string>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'pvp-overlay', parent);
    this.root.hidden = true;
    this.count = el('div', 'pvp-count', this.root);
    this.warning = el('div', 'pvp-warning', this.root);
    this.warning.setAttribute('role', 'alert');
    this.downed = el('div', 'ui-dialog pvp-downed', this.root);
    el('div', 'pvp-downed-title', this.downed, t('pvp.downed.title'));
    this.downedBy = el('div', 'pvp-downed-by', this.downed);
    this.downedPre = el('span', '', this.downedBy);
    this.downedKiller = el('span', 'pvp-downed-killer', this.downedBy);
    this.downedVerb = el('span', '', this.downedBy);
    this.downedCount = el('div', 'pvp-downed-count', this.downed);
    this.downedLabel = el('div', 'pvp-downed-label', this.downed, t('pvp.downed.respawnIn'));
    this.status = el('div', 'pvp-status', this.root);
    this.reconnect = el('div', 'ui-dialog pvp-reconnect', this.root);
    this.reconnect.setAttribute('role', 'status');
  }

  hide(): void {
    this.root.hidden = true;
    this.last.clear();
  }

  update(s: Readonly<OverlayState>): void {
    this.root.hidden = false;
    this.text(
      this.count,
      'count',
      s.countdown > 0 ? String(Math.ceil(s.countdown - 1e-6)) : s.go ? 'GO!' : '',
    );
    this.count.classList.toggle('is-go', s.countdown <= 0 && s.go);
    this.text(this.warning, 'warning', s.warning);
    const d = s.downed;
    this.downed.hidden = d === null;
    if (d) {
      this.text(this.downedKiller, 'killer', d.killer ?? '');
      this.downedKiller.style.color = d.color;
      // 「{killer} に撃墜された」の {killer} の前後（語順は言語で違う）
      const [pre = '', post = ''] =
        d.killer === null ? ['', t('pvp.downed.crashed')] : t('pvp.downed.by').split('{killer}');
      this.text(this.downedPre, 'pre', pre);
      this.text(this.downedVerb, 'verb', post);
      // 9-6d: 残機なし: 数の代わりに「観戦中」
      const out = d.remaining < 0;
      this.text(
        this.downedCount,
        'downCount',
        out ? '—' : String(Math.max(0, Math.ceil(d.remaining - 1e-6))),
      );
      this.text(
        this.downedLabel,
        'downLabel',
        out ? t('pvp.downed.spectating') : t('pvp.downed.respawnIn'),
      );
    }
    const parts: string[] = [];
    if (s.invulnerable > 0 && !d)
      parts.push(t('pvp.status.invulnerable', { seconds: s.invulnerable.toFixed(1) }));
    if (s.boosted && !d) parts.push(t('pvp.status.boosted'));
    if (s.lives !== undefined && s.lives !== null && !d)
      parts.push(t('hud.lives', { lives: s.lives }));
    this.text(this.status, 'status', parts.join(t('pvp.status.sep')));
    this.status.classList.toggle('is-invulnerable', s.invulnerable > 0);
    const r = s.reconnect;
    this.reconnect.hidden = r === null;
    if (r !== null)
      this.text(this.reconnect, 'reconnect', t('net.reconnectingLeft', { seconds: Math.ceil(r) }));
  }

  /** 変わったときだけ書き換える。空なら隠す */
  private text(e: HTMLElement, key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    e.textContent = value;
    if (
      e !== this.downedPre &&
      e !== this.downedKiller &&
      e !== this.downedVerb &&
      e !== this.downedCount &&
      e !== this.downedLabel
    )
      e.hidden = value === '';
  }
}
