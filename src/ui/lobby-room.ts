// ロビーの部屋の画面（5-4。lobby.ts から分けた。9-10d で作り直した。PvP・協力レイド・協力防衛戦で同じ部品）:
// - 上の帯: 「‹ 退出」、題（例: PvP · 個人戦）、部屋コード（大きく）、「コピー」「共有」「QR」
// - 左の列: 「プレイヤー 3 / 4」と席の一覧（lobby-players.ts）。チーム戦はチームごと・ホストは「チームを自動で分ける」
// - 右: 「ルール」「補正」のタブ。押すだけで選べるボタン。ホストだけが変えられ、参加者には見るだけの表示と断り書き
// - 下の帯: 「機体 · （今の機体）」（ハンガー）、「定型文」（選ぶ小さなダイアログ）、今何を待っているか、主のボタン
//   （ホストは「開始」、参加者は「準備OK / 準備を取り消す」。押せないときは灰色）
// 判定・通信は今までどおり（設定の正規化は net/lobby-rules.ts、送るのは pvp-lobby-actions.ts）。文字は textContent だけで入れる
import {
  PVP_CONFIG,
  PVP_MODES,
  PVP_SCORE_LIMITS,
  PVP_TIME_LIMITS,
  QUICK_PHRASES,
} from '../data/pvp';
import { normalizeSettings, startBlock } from '../net/lobby-rules';
import { roomTitle, waitText } from './lobby-text';
import { findAircraftModel } from '../data/aircraft';
import { findMap, SELECTABLE_MAPS } from '../data/maps';
import { WEATHER_PRESETS, weatherLabel, weatherShortLabel } from '../data/weather';
import type { GameSettings, PlayerInfo } from '../net/protocol';
import { t, tn } from '../core/i18n';
import { NET_CONFIG } from '../data/net';
import { el } from './hud-dom';
import { LobbyShare } from './lobby-share';
import { renderLobbyPlayers } from './lobby-players';
import { LobbyChat } from './lobby-chat';
import { PanelTabs } from './panel-tabs';
import { createButton } from './screen';
import {
  minutes,
  parseMode,
  RULE_TOGGLES,
  ruleSegment,
  toggle,
  type RuleToggle,
  raidRuleSegments,
} from './lobby-controls';
import type { Segmented } from './segmented';
import './lobby-room.css';

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

const CONFIG_TABS = ['rules', 'options'] as const;
type ConfigTab = (typeof CONFIG_TABS)[number];

export class LobbyRoom {
  readonly root: HTMLDivElement;
  private readonly share: LobbyShare;
  private readonly chat: LobbyChat;
  private readonly title: HTMLDivElement;
  private readonly codeText: HTMLDivElement;
  private readonly seatsHead: HTMLSpanElement;
  private readonly list: HTMLDivElement;
  private readonly autoTeams: HTMLButtonElement;
  private readonly config: HTMLDivElement;
  private readonly tabs: PanelTabs<ConfigTab>;
  private readonly hostOnly: HTMLParagraphElement;
  private readonly mapFixed: HTMLParagraphElement;
  private readonly mapSelect: Segmented;
  private readonly weatherSelect: Segmented;
  private readonly scoreSelect: Segmented;
  private readonly timeSelect: Segmented;
  private readonly modeSelect: Segmented;
  private readonly difficultySelect: Segmented;
  /** 9-6c: レイドの怪獣（レイドのときだけ出す） */
  private readonly kaijuSelect: Segmented;
  /** 補正の ON/OFF（強化の無効・初心者保護・9-3 の狙いの補助・自動射撃） */
  private readonly ruleToggles = new Map<RuleToggle, HTMLButtonElement>();
  private readonly hangarButton: HTMLButtonElement;
  private readonly waitLine: HTMLParagraphElement;
  private readonly startButton: HTMLButtonElement;
  private readonly readyButton: HTMLButtonElement;
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

    // 上の帯
    const top = el('div', 'lobby-top', this.root);
    createButton(top, 'ui-button is-ghost lobby-leave', `‹ ${t('lobby.leave')}`, h.onLeave);
    this.title = el('div', 'lobby-title', top);
    const code = el('div', 'lobby-code-box', top);
    el('div', 'lobby-code-label', code, t('lobby.room.code'));
    this.codeText = el('div', 'lobby-code', code);
    // 9-6c: 通信の版（違う版の人は参加できない。見比べる用に小さく）
    el('div', 'lobby-protocol', code, t('lobby.protocol', { version: NET_CONFIG.protocolVersion }));
    this.share = new LobbyShare(top, overlayParent);

    // 左: 席
    const seats = el('div', 'lobby-seats', this.root);
    const seatsTop = el('div', 'lobby-seats-head', seats);
    this.seatsHead = el('span', 'lobby-seats-count', seatsTop);
    this.autoTeams = createButton(
      seatsTop,
      'ui-button lobby-auto-teams',
      t('lobby.autoTeams'),
      h.onAutoTeams,
    );
    this.list = el('div', 'lobby-seat-list', seats);

    // 右: ルール・補正
    this.config = el('div', 'lobby-config', this.root);
    this.tabs = new PanelTabs(this.config, CONFIG_TABS, (tab) =>
      t(tab === 'rules' ? 'lobby.rule.rules' : 'lobby.rule.options'),
    );
    const rules = el('div', 'lobby-rule-grid', this.tabs.pane('rules'));
    const changed = (): void => {
      const v = this.view;
      if (!v) return;
      const mode = parseMode(this.modeSelect.value);
      h.onSettings(
        normalizeSettings({
          ...v.settings,
          mapId: this.mapSelect.value,
          scoreLimit: Number(this.scoreSelect.value),
          timeLimitSeconds: Number(this.timeSelect.value),
          mode,
          hard: this.difficultySelect.value === 'hard',
          raidKaiju: Number(this.kaijuSelect.value) || 0,
          weather: this.weatherSelect.value,
        }),
      );
    };
    this.modeSelect = ruleSegment(
      rules,
      t('lobby.rule.mode'),
      PVP_MODES,
      (v) => t(`lobby.modeShort.${parseMode(String(v))}`),
      changed,
    );
    // 6-4: マップ（PvP・防衛戦。島・港湾都市。レイドは港湾都市に固定なので文字で出す）
    this.mapSelect = ruleSegment(
      rules,
      t('lobby.rule.map'),
      SELECTABLE_MAPS.map((m) => m.id),
      (id) => findMap(String(id)).name,
      changed,
    );
    this.timeSelect = ruleSegment(
      rules,
      t('lobby.rule.time'),
      PVP_TIME_LIMITS,
      (v) => minutes(Number(v)),
      changed,
    );
    this.scoreSelect = ruleSegment(
      rules,
      t('lobby.rule.score'),
      PVP_SCORE_LIMITS,
      (v) => tn('lobby.kills', Number(v)),
      changed,
    );
    // 9-6c: レイドの怪獣（ヴォルガス / ネフィルガ）と 6-6 のレイド・防衛戦の難易度
    [this.kaijuSelect, this.difficultySelect] = raidRuleSegments(rules, changed);
    // 7-5: 天候（全員が同じ天候。4 個ずつ 2 段）
    this.weatherSelect = ruleSegment(
      rules,
      t('lobby.rule.weather'),
      WEATHER_PRESETS.map((w) => w.id),
      (id) => weatherShortLabel(String(id)),
      changed,
      'lobby-seg-weather',
    );
    // 短い名前のボタンに、長い名前（風も）を title で
    for (const b of this.weatherSelect.root.querySelectorAll<HTMLButtonElement>('.ui-seg-item'))
      b.title = weatherLabel(b.dataset.value ?? '');
    this.mapFixed = el('p', 'lobby-map-fixed', rules);
    const toggles = el('div', 'lobby-toggles', this.tabs.pane('options'));
    // 9-3: 狙いの補助・自動射撃（個人戦・チーム戦だけ出す。協力は各自の設定のまま）
    for (const [key, label] of RULE_TOGGLES)
      this.ruleToggles.set(
        key,
        toggle(toggles, t(label), () => {
          const v = this.view;
          if (v?.isHost) h.onSettings({ ...v.settings, [key]: !v.settings[key] });
        }),
      );
    // 参加者への断り書きはタブの列の右端に（中身の高さを使わない）
    this.hostOnly = el('p', 'lobby-host-only', this.tabs.bar, t('lobby.room.hostOnly'));
    this.tabs.show('rules');

    // 下の帯
    const bottom = el('div', 'lobby-bottom', this.root);
    this.hangarButton = createButton(bottom, 'ui-button lobby-hangar-button', '', h.onHangar);
    this.chat = new LobbyChat(overlayParent, h.onChat);
    createButton(bottom, 'ui-button lobby-chat-open', t('lobby.room.chat'), () => {
      this.chat.open();
    });
    this.waitLine = el('p', 'lobby-wait', bottom);
    this.waitLine.setAttribute('role', 'status');
    this.readyButton = createButton(
      bottom,
      'ui-button is-primary lobby-main lobby-ready',
      t('lobby.ready'),
      () => {
        const v = this.view;
        const me = v?.players.find((p) => p.id === v.localId);
        if (me) h.onReady(!me.ready);
      },
    );
    this.startButton = createButton(
      bottom,
      'ui-button is-primary lobby-main lobby-start',
      t('lobby.start'),
      h.onStart,
    );
  }

  /** 名簿・設定が変わるたびに描き直す */
  render(v: Readonly<LobbyRoomView>): void {
    this.view = v;
    const st = v.settings;
    this.title.textContent = roomTitle(st);
    this.codeText.textContent = v.code;
    this.share.set(v.code, v.joinUrl);
    this.seatsHead.textContent = t('lobby.room.players', {
      count: String(v.players.length),
      max: String(NET_CONFIG.maxPlayers),
    });
    this.autoTeams.hidden = !(v.isHost && st.mode === 'team');
    this.renderPlayers(v);
    this.renderConfig(v);
    const me = v.players.find((p) => p.id === v.localId);
    const craft = me ? (findAircraftModel(me.aircraftId)?.name ?? me.aircraftId) : '—';
    this.hangarButton.textContent = t('lobby.room.aircraft', { name: craft });
    this.chat.sync(st);
    const block = startBlock(v.players, st.mode);
    this.startButton.hidden = !v.isHost;
    this.startButton.disabled = block !== null;
    this.readyButton.hidden = v.isHost;
    this.readyButton.textContent = me?.ready ? t('lobby.unready') : t('lobby.ready');
    this.readyButton.classList.toggle('is-primary', !me?.ready);
    this.waitLine.textContent = waitText(v);
  }

  private renderConfig(v: Readonly<LobbyRoomView>): void {
    const st = v.settings;
    const raid = st.mode === 'raid';
    // 7-2: 防衛戦はマップ（島・港湾都市）と難易度を選ぶ（撃墜数・制限時間は使わない）
    const defense = st.mode === 'defense';
    const versus = !raid && !defense;
    this.mapSelect.root.hidden = raid;
    this.scoreSelect.root.hidden = !versus;
    this.timeSelect.root.hidden = !versus;
    this.difficultySelect.root.hidden = versus;
    this.kaijuSelect.root.hidden = !raid;
    this.mapFixed.hidden = !raid;
    this.mapFixed.textContent = t('lobby.room.mapFixed', { map: v.mapName });
    this.modeSelect.value = st.mode;
    this.mapSelect.value = st.mapId;
    this.weatherSelect.value = st.weather;
    this.scoreSelect.value = String(st.scoreLimit);
    this.timeSelect.value = String(st.timeLimitSeconds);
    this.difficultySelect.value = st.hard ? 'hard' : 'normal';
    this.kaijuSelect.value = String(st.raidKaiju);
    for (const [key, b] of this.ruleToggles) {
      b.setAttribute('aria-pressed', String(st[key]));
      if (key === 'aimAssist' || key === 'autoFire') b.hidden = raid || defense;
    }
    // 参加者は見るだけ（押せない・断り書き）
    this.config.classList.toggle('is-readonly', !v.isHost);
    this.hostOnly.hidden = v.isHost;
    for (const b of this.config.querySelectorAll<HTMLButtonElement>(
      '.lobby-rule-grid .ui-seg-item, .lobby-toggle',
    ))
      b.disabled = !v.isHost;
  }

  /** 定型文を出す（その人の席に 3 秒） */
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
    if (this.chat.isOpen) {
      this.chat.close();
      return true;
    }
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
