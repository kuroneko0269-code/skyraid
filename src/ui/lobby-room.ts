// ロビーの部屋の画面（5-4。lobby.ts から分けた）: 部屋コードと共有、ルール（ホストは選べる: 撃墜数・時間・モード・
// 強化の無効・初心者保護）、参加者（色・名前・機体・チーム・準備）、定型文、退出 / ハンガー / 準備（クライアント）・開始（ホスト）。
// すべてタッチで押せる大きさ。文字は textContent だけで入れる
import { findAircraftModel } from '../data/aircraft';
import {
  PVP_CONFIG,
  PVP_QUICK_PHRASES,
  QUICK_PHRASES,
  RAID_PHRASE_BASE,
  PVP_MODES,
  PVP_SCORE_LIMITS,
  PVP_TEAM,
  PVP_TIME_LIMITS,
} from '../data/pvp';
import { isReady, normalizeSettings, startBlock, type StartBlock } from '../net/lobby-rules';
import { findMap, SELECTABLE_MAPS } from '../data/maps';
import { WEATHER_PRESETS, weatherLabel } from '../data/weather';
import { RAID_DIFFICULTIES, RAID_DIFFICULTY_LABELS, RAID_QUICK_PHRASES } from '../data/raid';
import type { GameSettings, PlayerInfo } from '../net/protocol';
import { el } from './hud-dom';
import { LobbyShare } from './lobby-share';
import { playerColorCss, teamColorCss } from './lobby-colors';
import { createButton } from './screen';
import { MODE_LABELS, numberSelect, parseMode, toggle } from './lobby-controls';

export interface LobbyRoomView {
  code: string;
  /** 参加用 URL（?room=コード） */
  joinUrl: string;
  isHost: boolean;
  localId: number;
  players: readonly PlayerInfo[];
  mapName: string;
  settings: GameSettings;
}

export interface LobbyRoomHandlers {
  onStart: () => void;
  onLeave: () => void;
  onHangar: () => void;
  onReady: (ready: boolean) => void;
  onSettings: (settings: GameSettings) => void;
  onTeam: (playerId: number, team: number) => void;
  onAutoTeams: () => void;
  onChat: (phrase: number) => void;
}

const minutes = (s: number): string => `${Math.round(s / 60)} 分`;

const BLOCK_TEXT: Record<Exclude<StartBlock, null>, string> = {
  players: 'ほかのプレイヤーに部屋コードを伝えてください',
  ready: '全員の「準備OK」を待っています',
  away: '再接続を待っています',
  teams: '両方のチームに 1 人以上入れてください',
};

export class LobbyRoom {
  readonly root: HTMLDivElement;
  private readonly share: LobbyShare;
  private readonly codeText: HTMLDivElement;
  private readonly rulesText: HTMLSpanElement;
  private readonly optionsText: HTMLSpanElement;
  private readonly mapText: HTMLSpanElement;
  private readonly mapSelect: HTMLSelectElement;
  private readonly weatherText: HTMLSpanElement;
  private readonly weatherSelect: HTMLSelectElement;
  private readonly rules: HTMLDivElement;
  private readonly scoreSelect: HTMLSelectElement;
  private readonly timeSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly noUpgrades: HTMLButtonElement;
  private readonly rookie: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly autoTeams: HTMLButtonElement;
  private readonly waitText: HTMLParagraphElement;
  private readonly startButton: HTMLButtonElement;
  private readonly readyButton: HTMLButtonElement;
  private readonly difficultySelect: HTMLSelectElement;
  private readonly raidChat: HTMLButtonElement[];
  /** 定型文の吹き出し（プレイヤー ID → 文と消す時刻 ms） */
  private readonly bubbles = new Map<number, { text: string; until: number }>();
  private bubbleTimer = 0;
  private view: LobbyRoomView | null = null;

  constructor(
    parent: HTMLElement,
    overlayParent: HTMLElement,
    private readonly h: LobbyRoomHandlers,
  ) {
    this.root = el('div', 'lobby-view lobby-room', parent);
    const left = el('div', 'lobby-col', this.root);
    const right = el('div', 'lobby-col', this.root);
    el('div', 'campaign-label', left, 'ROOM CODE');
    this.codeText = el('div', 'lobby-code', left);
    this.share = new LobbyShare(left, overlayParent);
    const facts = el('div', 'campaign-facts', left);
    const fact = (label: string): HTMLSpanElement => {
      const f = el('div', 'campaign-fact', facts);
      el('span', 'campaign-fact-label', f, label);
      return el('span', 'campaign-fact-value', f);
    };
    this.mapText = fact('マップ');
    this.weatherText = fact('天候');
    this.rulesText = fact('ルール');
    this.optionsText = fact('補正');
    // ホストの設定（5-3: 撃墜数・時間、5-4: モード・強化の無効・初心者保護）
    this.rules = el('div', 'campaign-facts lobby-rules', left);
    const changed = (): void => {
      const v = this.view;
      if (!v) return;
      h.onSettings(
        normalizeSettings({
          ...v.settings,
          mapId: this.mapSelect.value,
          scoreLimit: Number(this.scoreSelect.value),
          timeLimitSeconds: Number(this.timeSelect.value),
          mode: parseMode(this.modeSelect.value),
          hard: this.difficultySelect.value === 'hard',
          weather: this.weatherSelect.value,
        }),
      );
    };
    // 6-4: マップ（レイドは港湾都市に固定なので出さない）
    this.mapSelect = numberSelect(
      this.rules,
      'マップ',
      SELECTABLE_MAPS.map((m) => m.id),
      (id) => findMap(String(id)).name,
      changed,
    );
    // 7-5: 天候（PvP・協力レイドとも。全員が同じ天候）
    this.weatherSelect = numberSelect(
      this.rules,
      '天候',
      WEATHER_PRESETS.map((w) => w.id),
      (id) => weatherLabel(String(id)),
      changed,
    );
    this.scoreSelect = numberSelect(
      this.rules,
      '撃墜数',
      PVP_SCORE_LIMITS,
      (v) => `${v} 機`,
      changed,
    );
    this.timeSelect = numberSelect(
      this.rules,
      '制限時間',
      PVP_TIME_LIMITS,
      (v) => minutes(Number(v)),
      changed,
    );
    this.modeSelect = numberSelect(
      this.rules,
      'モード',
      PVP_MODES,
      (v) => MODE_LABELS[parseMode(String(v))],
      changed,
    );
    // 6-6: レイドの難易度（レイドのときだけ出す）
    this.difficultySelect = numberSelect(
      this.rules,
      '難易度',
      RAID_DIFFICULTIES,
      (v) => (v === 'hard' ? RAID_DIFFICULTY_LABELS.hard : RAID_DIFFICULTY_LABELS.normal),
      changed,
    );
    const toggles = el('div', 'lobby-toggles', this.rules);
    const flip = (key: 'noUpgrades' | 'rookieGuard') => () => {
      const v = this.view;
      if (v) h.onSettings({ ...v.settings, [key]: !v.settings[key] });
    };
    this.noUpgrades = toggle(toggles, '強化を無効にする', flip('noUpgrades'));
    this.rookie = toggle(toggles, '初心者保護', flip('rookieGuard'));
    el('div', 'campaign-label', right, 'PILOTS');
    this.list = el('ul', 'lobby-players', right);
    this.autoTeams = createButton(
      right,
      'ui-button lobby-wide',
      'チームを自動で分ける',
      h.onAutoTeams,
    );
    el('div', 'campaign-label', right, 'MESSAGE');
    const chat = el('div', 'lobby-chat', right);
    PVP_QUICK_PHRASES.forEach((text, i) => {
      createButton(chat, 'ui-button lobby-chat-button', text, () => {
        h.onChat(i);
      });
    });
    // 6-6: レイドだけの定型文（レイドのときだけ出す）
    this.raidChat = RAID_QUICK_PHRASES.map((text, i) =>
      createButton(chat, 'ui-button lobby-chat-button', text, () => {
        h.onChat(RAID_PHRASE_BASE + i);
      }),
    );
    this.waitText = el('p', 'briefing-text lobby-wait', this.root);
    const buttons = el('div', 'campaign-buttons lobby-buttons', this.root);
    createButton(buttons, 'ui-button is-ghost campaign-back', '退出', h.onLeave);
    createButton(buttons, 'ui-button lobby-hangar-button', 'ハンガー', h.onHangar);
    this.readyButton = createButton(buttons, 'ui-button is-primary campaign-go', '準備OK', () => {
      const v = this.view;
      const me = v?.players.find((p) => p.id === v.localId);
      if (me) h.onReady(!me.ready);
    });
    this.startButton = createButton(buttons, 'ui-button is-primary campaign-go', '開始', h.onStart);
  }

  /** 名簿・設定が変わるたびに描き直す */
  render(v: Readonly<LobbyRoomView>): void {
    this.view = v;
    const st = v.settings;
    this.codeText.textContent = v.code;
    this.share.set(v.code, v.joinUrl);
    this.mapText.textContent = v.mapName;
    this.weatherText.textContent = weatherLabel(st.weather);
    // レイド（6-2）は撃墜数・制限時間を使わない（怪獣を倒すか、最終フェーズの時間切れで終わる）
    this.rulesText.textContent =
      st.mode === 'raid'
        ? `レイド（協力）・ヴォルガス撃破・${RAID_DIFFICULTY_LABELS[st.hard ? 'hard' : 'normal']}`
        : `${st.mode === 'team' ? 'チーム戦' : '個人戦'}・撃墜 ${st.scoreLimit} 機・${minutes(st.timeLimitSeconds)}`;
    const raid = st.mode === 'raid';
    for (const s of [this.scoreSelect, this.timeSelect, this.mapSelect]) {
      const row = s.parentElement;
      if (row) row.hidden = raid;
    }
    const diffRow = this.difficultySelect.parentElement;
    if (diffRow) diffRow.hidden = !raid;
    this.difficultySelect.value = st.hard ? 'hard' : 'normal';
    for (const b of this.raidChat) b.hidden = !raid;
    this.optionsText.textContent = `強化 ${st.noUpgrades ? '無効' : '有効'}・初心者保護 ${st.rookieGuard ? 'ON' : 'OFF'}`;
    this.rules.hidden = !v.isHost;
    // ホストは選ぶ欄に同じことが出ているので、文字のルールは出さない（横画面のスマホで縦に詰める）
    const rulesFact = this.rulesText.parentElement;
    const optionsFact = this.optionsText.parentElement;
    if (rulesFact) rulesFact.hidden = v.isHost;
    if (optionsFact) optionsFact.hidden = v.isHost;
    const weatherFact = this.weatherText.parentElement;
    if (weatherFact) weatherFact.hidden = v.isHost;
    this.mapSelect.value = st.mapId;
    this.weatherSelect.value = st.weather;
    this.scoreSelect.value = String(st.scoreLimit);
    this.timeSelect.value = String(st.timeLimitSeconds);
    this.modeSelect.value = st.mode;
    this.noUpgrades.setAttribute('aria-pressed', String(st.noUpgrades));
    this.rookie.setAttribute('aria-pressed', String(st.rookieGuard));
    this.autoTeams.hidden = !(v.isHost && st.mode === 'team');
    this.renderPlayers(v);
    const block = startBlock(v.players, st.mode);
    const me = v.players.find((p) => p.id === v.localId);
    this.startButton.hidden = !v.isHost;
    this.startButton.disabled = block !== null;
    this.readyButton.hidden = v.isHost;
    this.readyButton.textContent = me?.ready ? '準備を取り消す' : '準備OK';
    this.readyButton.classList.toggle('is-primary', !me?.ready);
    this.waitText.textContent = v.isHost
      ? block === null
        ? '全員の準備ができました。「開始」で 3 秒後に始まります'
        : BLOCK_TEXT[block]
      : me?.ready
        ? 'ホストの開始を待っています'
        : '機体を選んで「準備OK」を押してください';
  }

  /** 定型文を出す（その人の行に 3 秒） */
  showChat(from: number, phrase: number): void {
    const text = QUICK_PHRASES[phrase];
    if (!text) return;
    this.bubbles.set(from, { text, until: performance.now() + PVP_CONFIG.chat.showSeconds * 1000 });
    if (this.view) this.renderPlayers(this.view);
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(
      () => {
        if (this.view) this.renderPlayers(this.view);
      },
      PVP_CONFIG.chat.showSeconds * 1000 + 50,
    );
  }

  closeDialogs(): boolean {
    if (!this.share.qrOpen) return false;
    this.share.closeQr();
    return true;
  }

  focusMain(): void {
    const v = this.view;
    (v?.isHost ? this.startButton : this.readyButton).focus({ preventScroll: true });
  }

  private renderPlayers(v: Readonly<LobbyRoomView>): void {
    const team = v.settings.mode === 'team';
    const now = performance.now();
    this.list.replaceChildren();
    for (const p of v.players) {
      const li = el('li', 'lobby-player', this.list);
      li.classList.toggle('is-away', p.away);
      const dot = el('span', 'lobby-dot', li);
      dot.style.background = playerColorCss(p.id);
      const who = el('span', 'lobby-who', li);
      el('span', 'lobby-name', who, p.name);
      el('span', 'lobby-craft', who, findAircraftModel(p.aircraftId)?.name ?? p.aircraftId);
      const tags = [p.id === 0 ? 'ホスト' : '', p.id === v.localId ? 'あなた' : ''].filter(Boolean);
      if (tags.length > 0) el('span', 'tag', li, tags.join('・'));
      const bubble = this.bubbles.get(p.id);
      if (bubble && bubble.until > now) el('span', 'lobby-bubble', li, bubble.text);
      if (team) this.teamChip(li, p, v.isHost);
      const status = p.away ? '再接続中' : p.id === 0 ? 'HOST' : p.ready ? 'READY' : '準備中';
      const s = el('span', 'lobby-status', li, status);
      s.classList.toggle('is-ready', isReady(p) && !p.away);
    }
  }

  /** チームの印。ホストは押すと A ⇄ B を入れ替える */
  private teamChip(li: HTMLElement, p: Readonly<PlayerInfo>, isHost: boolean): void {
    const name = PVP_TEAM.names[p.team === 1 ? 1 : 0];
    const label = `チーム ${name}`;
    const chip = isHost
      ? createButton(li, 'ui-button lobby-team', label, () => {
          this.h.onTeam(p.id, p.team === 1 ? 0 : 1);
        })
      : el('span', 'lobby-team', li, label);
    chip.style.color = teamColorCss(p.team);
  }
}
