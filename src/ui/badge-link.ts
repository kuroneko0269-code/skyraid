// 勲章（9-10）と画面・セーブの配線: 記録する飛行の始め（初期状態）から固定ステップごとに数え、飛行を出たときに判定して入れる。
// 記録から取れる勲章は保存のたび・起動のときに入れる（9-10 より前の記録はここでさかのぼって付く）。協力・PvP は対戦の終わりの集計から。
// 取ったお知らせは飛行の外（結果の画面・日替わりの画面・ロビー・モード選択）に出たときにまとめて 1 つ出す（飛行中は出さない）。
// リプレイの再生では入れない。報酬（クレジット）は勲章ごとに 1 回だけ
import { replayControlsOf } from '../core/control-settings';
import { formatCredits } from '../core/format';
import type { GameState, ScreenState } from '../core/game-state';
import { t } from '../core/i18n';
import type { Input } from '../core/input';
import { BADGE_CONFIG, badgeName } from '../data/badges';
import type { GamePlay } from '../missions/game-play';
import {
  assistLevelOf,
  assistQualifies,
  judgeMatch,
  judgeSortie,
  lowerAssist,
  SortieWatch,
  type AssistLevel,
  type MatchSummary,
} from '../missions/badges/sortie';
import { tallySortie } from '../missions/badges/tally';
import { awardBadges, syncRecordBadges, type BadgeAward } from '../progression/badges';
import { addDailyDay, addStats, statKey } from '../progression/stats';
import { onMatchEnd } from '../progression/match-events';
import type { SaveStore } from '../progression/save-store';
import type { ReplayHub } from '../replay/hub';
import type { ReplayStart } from '../replay/types';
import { BadgeScreen } from './badge-screen';
import type { ModeSelectScreen } from './mode-select';
import { showToast } from './toast';

export interface BadgeLinkParts {
  readonly game: GameState;
  readonly save: SaveStore;
  readonly play: GamePlay;
  readonly hub: ReplayHub;
  readonly input: Pick<Input, 'lastDevice' | 'steerMode'>;
  readonly modeSelect: ModeSelectScreen;
  /** 時刻（テスト用に差し替え） */
  readonly now?: () => number;
}

export interface BadgeLink {
  /** 記録する飛行を始めた（初期状態から世界を作った直後） */
  begin(start: ReplayStart): void;
  /** 本番の固定ステップの後 */
  step(dt: number): void;
  /** 一覧を開く（モード選択の「勲章」） */
  open(): void;
}

/** 飛行の画面（ポーズ・フォトモードも） */
const inFlight = (s: ScreenState): boolean => s === 'flight' || s === 'pause' || s === 'photo';

/** 取った勲章の 1 行（条件の文。9-10b: 節目は「勲章 N 個」） */
export function awardLabel(a: Pick<BadgeAward, 'id' | 'milestone'>): string {
  if (a.milestone !== undefined) return t('badges.toast.milestone', { count: a.milestone });
  return badgeName(a.id);
}

/** お知らせの文（名前は BADGE_CONFIG.toastNames 個まで、ほかは「ほか N 個」） */
export function awardText(list: readonly BadgeAward[], backfill: boolean): string {
  const credits = list.reduce((sum, a) => sum + a.credits, 0);
  const shown = list.slice(0, BADGE_CONFIG.toastNames).map(awardLabel);
  const rest = list.length - shown.length;
  const names =
    shown.join(t('badges.toast.separator')) +
    (rest > 0 ? t('badges.toast.more', { count: rest }) : '');
  const key = backfill ? 'badges.toast.backfill' : 'badges.toast.earned';
  return t(key, { names, count: list.length, credits: formatCredits(credits) });
}

export function createBadgeLink(p: BadgeLinkParts): BadgeLink {
  const { game, save, play, hub } = p;
  const now = p.now ?? (() => Date.now());
  const watch = new SortieWatch();
  let active: { start: ReplayStart; assist: boolean; level: AssistLevel | null } | null = null;
  // 9-10b: プレイヤーが落とした対象（武器・種類）。数えている飛行の間だけ受ける
  play.session.combat.killFeed.on((target, weapon) => {
    watch.kill(target, weapon);
  });
  /** まだ知らせていない勲章（飛行の外に出たら出す） */
  let pending: BadgeAward[] = [];
  let pendingBackfill: BadgeAward[] = [];
  let syncing = false;

  const controlsNow = () =>
    replayControlsOf(save.settings.controls, p.input.lastDevice, p.input.steerMode);
  const assistNow = (): boolean => assistQualifies(controlsNow());

  const flush = (): void => {
    const state = game.state;
    if (state === 'boot' || inFlight(state)) return;
    if (pendingBackfill.length > 0) {
      showToast(awardText(pendingBackfill, true), { seconds: BADGE_CONFIG.toastSeconds });
      pendingBackfill = [];
    }
    if (pending.length > 0) {
      showToast(awardText(pending, false), { seconds: BADGE_CONFIG.toastSeconds });
      pending = [];
    }
  };

  /** 判定した勲章を入れて知らせる（9-10b: 通算の記録に足す分・日替わりの日も同じ保存で） */
  const give = (
    ids: readonly string[],
    stats: Readonly<Record<string, number>> = {},
    dailyDay: string | null = null,
  ): void => {
    if (ids.length === 0 && Object.keys(stats).length === 0 && dailyDay === null) return;
    const got: BadgeAward[] = [];
    save.transact((data) => {
      addStats(data.stats, stats, now());
      if (dailyDay !== null) addDailyDay(data.stats, dailyDay);
      got.push(...awardBadges(data, ids, now()));
      return true;
    });
    pending.push(...got);
    flush();
  };

  /** 記録から取れる勲章（保存のたび・起動）。最初の 1 回はさかのぼりとして知らせる */
  const sync = (): void => {
    if (syncing || save.isLocked) return;
    syncing = true;
    try {
      const out: { backfill: boolean; got: BadgeAward[] } = { backfill: false, got: [] };
      save.transact((data) => {
        out.backfill = !data.badges.backfilled;
        data.badges.backfilled = true;
        out.got = syncRecordBadges(data, now());
        return out.got.length > 0 || out.backfill;
      });
      (out.backfill ? pendingBackfill : pending).push(...out.got);
    } finally {
      syncing = false;
    }
    flush();
  };
  save.onPersist(sync);
  sync();

  /** 飛行の終わり: 判定して入れる（何度呼んでもよい） */
  const finish = (): void => {
    const a = active;
    active = null;
    watch.end();
    if (!a || hub.playing) return;
    const legacy = judgeSortie(a.start, play, watch, a.assist && assistNow());
    // 9-10b: 補助の段は始めと終わりの設定の低い方。飛行中に自動射撃で撃ったら「かんたん」
    const level = watch.autoFired ? 'easy' : lowerAssist(a.level, assistLevelOf(controlsNow()));
    const tally = tallySortie(a.start, play, watch, level);
    give([...legacy, ...tally.badges], tally.stats, a.start.daily?.day ?? null);
  };

  onMatchEnd((m) => {
    give(judgeMatch(m), matchStats(m));
  });

  game.onChange(({ from, to }) => {
    if (inFlight(from) && !inFlight(to)) finish();
    if (!inFlight(to)) flush();
  });

  const screen = new BadgeScreen(document.body, p.modeSelect, game, {
    badges: () => save.snapshot,
  });

  return {
    begin(start) {
      finish();
      if (hub.playing) return;
      watch.begin(play);
      const controls = controlsNow();
      active = { start, assist: assistQualifies(controls), level: assistLevelOf(controls) };
    },
    step(dt) {
      if (!active || !hub.recording) return;
      // 記録した入力の印 8（引き金が自動射撃から）
      const autoFire = (hub.recorder.frame.flags & 8) !== 0;
      watch.step(play, dt, autoFire);
    },
    open() {
      screen.show();
    },
  };
}

/** 9-10b: 協力・PvP の対戦の終わりに通算の記録に足す分（協力は人数別の遊んだ / クリア、PvP は遊んだ・勝ち・撃墜） */
export function matchStats(m: Readonly<MatchSummary>): Record<string, number> {
  const out: Record<string, number> = {};
  const players = Math.max(1, Math.min(4, Math.round(m.players)));
  if (m.coop) {
    out[statKey.coopPlays(players)] = 1;
    if (m.coopClear) out[statKey.coopClears(players)] = 1;
  } else if (m.players >= 2) {
    out[statKey.pvpPlays] = 1;
    if (m.pvpWin) out[statKey.pvpWins] = 1;
    if (m.kills > 0) out[statKey.pvpKills] = m.kills;
  }
  return out;
}
