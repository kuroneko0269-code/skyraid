// PvP の飛行中の DOM（5-1）: 他プレイヤーの名札（機体の画面上の位置。5-3 から HP バー）、Esc / ⏸ のメニュー
// （ゲームは止まらない）、お知らせ、?netdebug の通信の値。撃墜のフィード・スコアボード・残り時間は pvp-board.ts
import { Vector3, type PerspectiveCamera } from 'three';
import { NET_CONFIG } from '../data/net';
import type { NetStats, RemoteSample } from '../net/net-game';
import type { PlayerInfo } from '../net/protocol';
import { el } from './hud-dom';
import { playerColorCss } from './lobby-colors';
import { createButton } from './screen';

const projected = new Vector3();

interface Tag {
  readonly root: HTMLDivElement;
  readonly name: HTMLSpanElement;
  readonly dist: HTMLSpanElement;
  readonly hp: HTMLDivElement;
  lastName: string;
  lastDist: number;
  lastHp: number;
  lastInvulnerable: boolean;
}

export class PvpHud {
  private readonly tagLayer: HTMLDivElement;
  private readonly tags = new Map<number, Tag>();
  private readonly menu: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly debug: HTMLPreElement;
  private toastTimer = 0;
  private debugTimer = 0;

  constructor(
    parent: HTMLElement,
    handlers: { onContinue: () => void; onLeave: () => void },
    private readonly debugShown: boolean,
  ) {
    this.tagLayer = el('div', 'pvp-tags', parent);
    this.tagLayer.hidden = true;
    this.menu = el('div', 'pvp-menu', parent);
    this.menu.hidden = true;
    const box = el('div', 'ui-dialog pvp-menu-box', this.menu);
    el('h3', 'ui-heading', box, 'PvP');
    el('p', 'briefing-text', box, '対戦中は一時停止できません（機体は飛び続けます）');
    const buttons = el('div', 'campaign-buttons', box);
    // 押せないように見えないよう、灰色の is-ghost ではなく赤（確認なしで 1 回で抜ける。再接続はロビーから）
    createButton(buttons, 'ui-button is-danger campaign-back', '退出する', handlers.onLeave);
    createButton(buttons, 'ui-button is-primary campaign-go', '続ける', handlers.onContinue);
    this.toast = el('div', 'ui-toast pvp-toast', parent);
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;
    this.debug = el('pre', 'pvp-debug', parent);
    this.debug.hidden = !debugShown;
  }

  get menuOpen(): boolean {
    return !this.menu.hidden;
  }

  setMenuOpen(open: boolean): void {
    this.menu.hidden = !open;
  }

  /** 数秒だけお知らせを出す */
  notify(text: string, seconds = 4): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, seconds * 1000);
  }

  /** 飛行の終わり: 名札・メニュー・デバッグを隠す */
  hide(): void {
    this.tagLayer.hidden = true;
    this.menu.hidden = true;
    for (const t of this.tags.values()) t.root.hidden = true;
    this.debug.textContent = '';
  }

  /** 名札を機体の画面上の位置へ（後ろ・画面外は隠す）。HP バーは最大 HP に対する割合（5-3） */
  updateTags(
    samples: readonly RemoteSample[],
    players: ReadonlyMap<number, PlayerInfo>,
    camera: PerspectiveCamera,
    width: number,
    height: number,
  ): void {
    this.tagLayer.hidden = false;
    for (const t of this.tags.values()) t.root.hidden = true;
    for (const s of samples) {
      if (!s.alive) continue;
      const tag = this.tagFor(s.id);
      projected.set(s.position.x, s.position.y, s.position.z);
      const dist = projected.distanceTo(camera.position);
      projected.project(camera);
      if (projected.z > 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1) continue;
      tag.root.hidden = false;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      tag.root.style.transform = `translate(${x.toFixed(1)}px, ${(y - 28).toFixed(1)}px) translateX(-50%)`;
      const info = players.get(s.id);
      const name = info?.name ?? '';
      const hp = info && info.maxHp > 0 ? Math.round((100 * s.hp) / info.maxHp) : 100;
      if (hp !== tag.lastHp) {
        tag.lastHp = hp;
        tag.hp.style.transform = `scaleX(${Math.max(0, Math.min(1, hp / 100)).toFixed(2)})`;
        tag.root.classList.toggle('is-low', hp <= 30);
      }
      if (s.invulnerable !== tag.lastInvulnerable) {
        tag.lastInvulnerable = s.invulnerable;
        tag.root.classList.toggle('is-invulnerable', s.invulnerable);
      }
      if (name !== tag.lastName) {
        tag.lastName = name;
        tag.name.textContent = name;
      }
      const d = Math.round(dist / 10) * 10;
      if (d !== tag.lastDist) {
        tag.lastDist = d;
        tag.dist.textContent = d >= 1000 ? ` ${(d / 1000).toFixed(1)}km` : ` ${d}m`;
      }
    }
  }

  /** ?netdebug: RTT・受信レート・補間遅延（0.25 秒ごとに書き換える） */
  updateDebug(stats: NetStats, localId: number, players: number, dt: number): void {
    if (!this.debugShown) return;
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = NET_CONFIG.debugRefreshSeconds;
    const rtt = stats.rttMs === null ? '--' : `${Math.round(stats.rttMs)}ms`;
    const lines = [
      `NET ${stats.role}  id ${localId}  ${players}人`,
      `RTT ${rtt}  state ${stats.stateRate}/s`,
    ];
    if (stats.role === 'client') {
      lines.push(
        `補間遅延 ${Math.round(stats.interpDelayMs)}ms  余裕 ${Math.round(stats.bufferMarginMs)}ms`,
        `外挿 ${stats.extrapolating}機  自機の補正 ${stats.corrections}回`,
      );
    } else {
      lines.push(
        `入力の溜め ${stats.inputBacklog}  推測 ${stats.inputGuessed}  溜め直し ${stats.inputResyncs}`,
        `遅延補償の巻き戻し ${Math.round(stats.rewindMs)}ms`,
      );
    }
    this.debug.textContent = lines.join('\n');
  }

  private tagFor(id: number): Tag {
    let t = this.tags.get(id);
    if (!t) {
      const root = el('div', 'pvp-tag', this.tagLayer);
      root.style.color = playerColorCss(id);
      const label = el('div', 'pvp-tag-label', root);
      const name = el('span', 'pvp-tag-name', label);
      const dist = el('span', 'pvp-tag-dist', label);
      const bar = el('div', 'pvp-tag-hp', root);
      const hp = el('div', 'pvp-tag-hp-fill', bar);
      t = { root, name, dist, hp, lastName: '', lastDist: -1, lastHp: -1, lastInvulnerable: false };
      this.tags.set(id, t);
    }
    return t;
  }
}
