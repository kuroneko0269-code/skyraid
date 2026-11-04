// ロビーの部屋の画面（5-4。lobby.ts から分けた）: 部屋コードと共有、ルール（ホストは選べる: 撃墜数・時間・モード・
// 強化の無効・初心者保護）、参加者（色・名前・機体・チーム・準備）、定型文、退出 / ハンガー / 準備（クライアント）・開始（ホスト）。
// すべてタッチで押せる大きさ。文字は textContent だけで入れる
import {
  PVP_CONFIG,
  PVP_QUICK_PHRASES,
  QUICK_PHRASES,
  RAID_PHRASE_BASE,
  PVP_MODES,
  PVP_SCORE_LIMITS,
  PVP_TIME_LIMITS,
} from '../data/pvp';
import { normalizeSettings, startBlock, type StartBlock } from '../net/lobby-rules';
import { findMap, SELECTABLE_MAPS } from '../data/maps';
import { WEATHER_PRESETS, weatherLabel } from '../data/weather';
import { RAID_QUICK_PHRASES } from '../data/raid';
import type { GameSettings, PlayerInfo } from '../net/protocol';
import { t, tn } from '../core/i18n';
import { NET_CONFIG } from '../data/net';
import { el } from './hud-dom';
import { LobbyShare } from './lobby-share';
import { renderLobbyPlayers } from './lobby-players';
import { createButton } from './screen';
import {
  MODE_LABELS,
  minutes,
  optionsSummary,
  parseMode,
  RULE_TOGGLES,
  ruleSegment,
  rulesSummary,
  toggle,
  type RuleToggle,
  raidRuleSegments,
  syncRaidChat,
} from './lobby-controls';
import type { Segmented } from './segmented';

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

const BLOCK_TEXT: Record<Exclude<StartBlock, null>, string> = {
  get players() {
    return t('lobby.block.players');
  },
  get ready() {
    return t('lobby.block.ready');
  },
  get away() {
    return t('lobby.block.away');
  },
  get teams() {
    return t('lobby.block.teams');
  },
};

export class LobbyRoom {
  readonly root: HTMLDivElement;
  private readonly share: LobbyShare;
  private readonly codeText: HTMLDivElement;
  private readonly rulesText: HTMLSpanElement;
  private readonly optionsText: HTMLSpanElement;
  private readonly mapText: HTMLSpanElement;
  private readonly mapSelect: Segmented;
  private readonly weatherText: HTMLSpanElement;
  private readonly weatherSelect: Segmented;
  private readonly rules: HTMLDivElement;
  private readonly scoreSelect: Segmented;
  private readonly timeSelect: Segmented;
  private readonly modeSelect: Segmented;
  /** 補正の ON/OFF（強化の無効・初心者保護・9-3 の狙いの補助・自動射撃） */
  private readonly ruleToggles = new Map<RuleToggle, HTMLButtonElement>();
  private readonly list: HTMLUListElement;
  private readonly autoTeams: HTMLButtonElement;
  private readonly waitText: HTMLParagraphElement;
  private readonly startButton: HTMLButtonElement;
  private readonly readyButton: HTMLButtonElement;
  private readonly difficultySelect: Segmented;
  /** 9-6c: レイドの怪獣（レイドのときだけ出す） */
  private readonly kaijuSelect: Segmented;
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
    // 9-6c: 通信の版（違う版の人は参加できない。参加できないと言われたときに見比べる）
    el('div', 'lobby-protocol', left, t('lobby.protocol', { version: NET_CONFIG.protocolVersion }));
    const facts = el('div', 'campaign-facts', left);
    const fact = (label: string): HTMLSpanElement => {
      const f = el('div', 'campaign-fact', facts);
      el('span', 'campaign-fact-label', f, label);
      return el('span', 'campaign-fact-value', f);
    };
    this.mapText = fact(t('lobby.rule.map'));
    this.weatherText = fact(t('lobby.rule.weather'));
    this.rulesText = fact(t('lobby.rule.rules'));
    this.optionsText = fact(t('lobby.rule.options'));
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
          raidKaiju: Number(this.kaijuSelect.value) || 0,
          weather: this.weatherSelect.value,
        }),
      );
    };
    // 6-4: マップ（レイドは港湾都市に固定なので出さない）
    this.mapSelect = ruleSegment(
      this.rules,
      t('lobby.rule.map'),
      SELECTABLE_MAPS.map((m) => m.id),
      (id) => findMap(String(id)).name,
      changed,
    );
    // 7-5: 天候（PvP・協力レイドとも。全員が同じ天候）
    this.weatherSelect = ruleSegment(
      this.rules,
      t('lobby.rule.weather'),
      WEATHER_PRESETS.map((w) => w.id),
      (id) => weatherLabel(String(id)),
      changed,
      'lobby-seg-weather',
    );
    this.scoreSelect = ruleSegment(
      this.rules,
      t('lobby.rule.score'),
      PVP_SCORE_LIMITS,
      (v) => tn('lobby.kills', Number(v)),
      changed,
    );
    this.timeSelect = ruleSegment(
      this.rules,
      t('lobby.rule.time'),
      PVP_TIME_LIMITS,
      (v) => minutes(Number(v)),
      changed,
    );
    this.modeSelect = ruleSegment(
      this.rules,
      t('lobby.rule.mode'),
      PVP_MODES,
      (v) => MODE_LABELS[parseMode(String(v))],
      changed,
    );
    // 9-6c: レイドの怪獣（ヴォルガス / ネフィルガ）と 6-6 のレイドの難易度（レイドのときだけ出す）
    [this.kaijuSelect, this.difficultySelect] = raidRuleSegments(this.rules, changed);
    const toggles = el('div', 'lobby-toggles', this.rules);
    // 9-3: 狙いの補助・自動射撃（個人戦・チーム戦だけ出す。協力は各自の設定のまま）
    for (const [key, label] of RULE_TOGGLES)
      this.ruleToggles.set(
        key,
        toggle(toggles, t(label), () => {
          const v = this.view;
          if (v) h.onSettings({ ...v.settings, [key]: !v.settings[key] });
        }),
      );
    el('div', 'campaign-label', right, 'PILOTS');
    this.list = el('ul', 'lobby-players', right);
    this.autoTeams = createButton(
      right,
      'ui-button lobby-wide',
      t('lobby.autoTeams'),
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
    createButton(buttons, 'ui-button is-ghost campaign-back', t('lobby.leave'), h.onLeave);
    createButton(buttons, 'ui-button lobby-hangar-button', t('lobby.hangarButton'), h.onHangar);
    this.readyButton = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('lobby.ready'),
      () => {
        const v = this.view;
        const me = v?.players.find((p) => p.id === v.localId);
        if (me) h.onReady(!me.ready);
      },
    );
    this.startButton = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('lobby.start'),
      h.onStart,
    );
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
    this.rulesText.textContent = rulesSummary(st);
    const raid = st.mode === 'raid';
    // 7-2: 防衛戦はマップ（島・港湾都市）と難易度を選ぶ（撃墜数・制限時間は使わない）
    const defense = st.mode === 'defense';
    for (const s of [this.scoreSelect, this.timeSelect, this.mapSelect])
      s.root.hidden = raid || (defense && s !== this.mapSelect);
    this.difficultySelect.root.hidden = !raid && !defense;
    this.difficultySelect.value = st.hard ? 'hard' : 'normal';
    this.kaijuSelect.root.hidden = !raid;
    this.kaijuSelect.value = String(st.raidKaiju);
    syncRaidChat(this.raidChat, st);
    this.optionsText.textContent = optionsSummary(st);
    this.rules.hidden = !v.isHost;
    // ホストは選ぶ欄に同じことが出ているので、文字のルールは出さない（横画面のスマホで縦に詰める）
    const rulesFact = this.rulesText.parentElement;
    const optionsFact = this.optionsText.parentElement;
    if (rulesFact) rulesFact.hidden = v.isHost;
    if (optionsFact) optionsFact.hidden = v.isHost;
    const weatherFact = this.weatherText.parentElement;
    if (weatherFact) weatherFact.hidden = v.isHost;
    // マップもホストは選ぶ欄に出ている（レイドは港湾都市に固定で選ぶ欄がないので文字で出す。7-C）
    const mapFact = this.mapText.parentElement;
    if (mapFact) mapFact.hidden = v.isHost && !raid;
    this.mapSelect.value = st.mapId;
    this.weatherSelect.value = st.weather;
    this.scoreSelect.value = String(st.scoreLimit);
    this.timeSelect.value = String(st.timeLimitSeconds);
    this.modeSelect.value = st.mode;
    for (const [key, b] of this.ruleToggles) {
      b.setAttribute('aria-pressed', String(st[key]));
      if (key === 'aimAssist' || key === 'autoFire') b.hidden = raid || defense;
    }
    this.autoTeams.hidden = !(v.isHost && st.mode === 'team');
    this.renderPlayers(v);
    const block = startBlock(v.players, st.mode);
    const me = v.players.find((p) => p.id === v.localId);
    this.startButton.hidden = !v.isHost;
    this.startButton.disabled = block !== null;
    this.readyButton.hidden = v.isHost;
    this.readyButton.textContent = me?.ready ? t('lobby.unready') : t('lobby.ready');
    this.readyButton.classList.toggle('is-primary', !me?.ready);
    this.waitText.textContent = v.isHost
      ? block === null
        ? t('lobby.wait.allReady')
        : BLOCK_TEXT[block]
      : me?.ready
        ? t('lobby.wait.host')
        : t('lobby.wait.pick');
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
    renderLobbyPlayers(this.list, v, this.bubbles, this.h.onTeam);
  }
}
