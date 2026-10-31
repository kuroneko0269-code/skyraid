// PvP の飛行中の大きな表示（5-4）: 開始前のカウントダウン（3・2・1・GO）、残り時間の警告（30 秒・10 秒）、
// 撃墜されたときの画面（撃墜した相手の名前・復帰までのカウント）、復帰後の無敵と初心者保護の表示、再接続中の表示。
// 描画フレームごとに update を呼び、文字が変わったときだけ書き換える。文字は textContent だけで入れる
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
}

export class PvpOverlay {
  private readonly root: HTMLDivElement;
  private readonly count: HTMLDivElement;
  private readonly warning: HTMLDivElement;
  private readonly downed: HTMLDivElement;
  private readonly downedBy: HTMLDivElement;
  private readonly downedKiller: HTMLSpanElement;
  private readonly downedVerb: HTMLSpanElement;
  private readonly downedCount: HTMLDivElement;
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
    el('div', 'pvp-downed-title', this.downed, '撃墜されました');
    this.downedBy = el('div', 'pvp-downed-by', this.downed);
    this.downedKiller = el('span', 'pvp-downed-killer', this.downedBy);
    this.downedVerb = el('span', '', this.downedBy);
    this.downedCount = el('div', 'pvp-downed-count', this.downed);
    el('div', 'pvp-downed-label', this.downed, '復帰まで');
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
      this.text(this.downedVerb, 'verb', d.killer === null ? '墜落' : ' に撃墜された');
      this.text(this.downedCount, 'downCount', String(Math.max(0, Math.ceil(d.remaining - 1e-6))));
    }
    const parts: string[] = [];
    if (s.invulnerable > 0 && !d) parts.push(`無敵 ${s.invulnerable.toFixed(1)}`);
    if (s.boosted && !d) parts.push('初心者保護 HP+50%・MSL+2');
    this.text(this.status, 'status', parts.join('　'));
    this.status.classList.toggle('is-invulnerable', s.invulnerable > 0);
    const r = s.reconnect;
    this.reconnect.hidden = r === null;
    if (r !== null)
      this.text(
        this.reconnect,
        'reconnect',
        `接続が途切れました。再接続しています…（残り ${Math.ceil(r)} 秒）`,
      );
  }

  /** 変わったときだけ書き換える。空なら隠す */
  private text(e: HTMLElement, key: string, value: string): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    e.textContent = value;
    if (e !== this.downedKiller && e !== this.downedVerb && e !== this.downedCount)
      e.hidden = value === '';
  }
}
