// PvP の飛行中の DOM（5-1）: 他プレイヤーの名札（機体の画面上の位置）、Esc / ⏸ のメニュー（ゲームは止まらない）、
// お知らせ、?netdebug の通信の値
import { Vector3, type PerspectiveCamera } from 'three';
import { NET_CONFIG } from '../data/net';
import type { NetStats, RemoteSample } from '../net/net-game';
import { el } from './hud-dom';
import { playerColorCss } from './lobby';
import { createButton } from './screen';

const projected = new Vector3();

interface Tag {
  readonly root: HTMLDivElement;
  readonly name: HTMLSpanElement;
  readonly dist: HTMLSpanElement;
  lastName: string;
  lastDist: number;
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
    createButton(buttons, 'ui-button is-ghost campaign-back', '退出する', handlers.onLeave);
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

  /** 名札を機体の画面上の位置へ（後ろ・画面外は隠す） */
  updateTags(
    samples: readonly RemoteSample[],
    names: ReadonlyMap<number, string>,
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
      const name = names.get(s.id) ?? '';
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
      );
    }
    this.debug.textContent = lines.join('\n');
  }

  private tagFor(id: number): Tag {
    let t = this.tags.get(id);
    if (!t) {
      const root = el('div', 'pvp-tag', this.tagLayer);
      root.style.color = playerColorCss(id);
      const name = el('span', 'pvp-tag-name', root);
      const dist = el('span', 'pvp-tag-dist', root);
      t = { root, name, dist, lastName: '', lastDist: -1 };
      this.tags.set(id, t);
    }
    return t;
  }
}
