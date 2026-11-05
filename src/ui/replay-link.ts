// リプレイ（7-B）と画面・保存の配線: 本番の飛行の記録の始め・終わり（終わったら IndexedDB に自動保存。直近 10 本）、
// リザルトの「リプレイを保存」（名前を付けて永久保存。30 本まで）、モード選択の「リプレイ」→ 一覧 → 再生、
// .skyreplay の書き出し・読み込み。再生中の操作は ui/replay-playback.ts。
// 8-2: 一覧・再生の操作・書き出し / 読み込みは別のチャンク（replay-ui.ts）にし、一覧を開くときに読む（loadUi）。
// 読めなければ（オフライン・古いチャンク）お知らせを出してモード選択へ戻る
import { loadKaiju2, missionNeedsKaiju2, needsKaiju2 } from './kaiju2-link';
import { APP_VERSION } from 'virtual:app-info';
import { replayControlsOf } from '../core/control-settings';
import type { GameState } from '../core/game-state';
import type { Input } from '../core/input';
import { t } from '../core/i18n';
import { REPLAY_CONFIG } from '../data/replay';
import type { DefenseRunner } from '../missions/defense/runner';
import type { GamePlay } from '../missions/game-play';
import type { SaveStore } from '../progression/save-store';
import { decodeHeader, decodeReplay, encodeReplay } from '../replay/codec';
import type { ReplayHub } from '../replay/hub';
import { replayOutcome, replayTitle } from '../replay/outcome';
import { missionFor, simHash, type SimWorld } from '../replay/sim';
import { ReplayStore, type ReplayEntry } from '../replay/store';
import type { ReplayData, ReplayStart } from '../replay/types';
import type { FlightReplayHooks } from './flight-start';
import type { FlightLoopReplay } from './flight-loop';
import type { ReplayListScreen } from './replay-list';
import type { ReplayPlayback } from './replay-playback';
import { ReplaySaveBox } from './replay-save';
import type * as ReplayUi from './replay-ui';

/** 再生の操作（8-2: replay-ui のチャンクを読んでから作る。作るまでは何もしない） */
export class PlaybackSlot {
  impl: ReplayPlayback | null = null;

  get active(): boolean {
    return this.impl?.active ?? false;
  }

  start(data: ReplayData): void {
    this.impl?.start(data);
  }

  stop(): void {
    this.impl?.stop();
  }

  update(): void {
    this.impl?.update();
  }

  stepOnce(): void {
    this.impl?.stepOnce();
  }

  render(): void {
    this.impl?.render();
  }
}

export interface ReplayLinkParts {
  readonly game: GameState;
  readonly hub: ReplayHub;
  readonly play: GamePlay;
  readonly world: SimWorld;
  readonly save: SaveStore;
  /** 記録の始めの入力系統と、タッチのスティックの方式（9-2。ヘッダの controls） */
  readonly input: Pick<Input, 'lastDevice' | 'steerMode'>;
  readonly playback: PlaybackSlot;
  /** 一覧・再生の操作のチャンクを読む（読み込みの表示付き。読めなければ null。読めたら playback も作る） */
  readonly loadUi: () => Promise<typeof ReplayUi | null>;
  /** リザルト（ミッション・レース・防衛戦）の追加の欄 */
  readonly resultExtras: readonly HTMLElement[];
}

export interface ReplayLink {
  readonly hooks: FlightReplayHooks;
  readonly loop: FlightLoopReplay;
}

/** 飛行の画面（ポーズ・フォトモードも含む） */
const inFlight = (s: string): boolean => s === 'flight' || s === 'pause' || s === 'photo';

export function createReplayLink(p: ReplayLinkParts): ReplayLink {
  const { game, hub, play, playback } = p;
  // IndexedDB が使えない（プライベートブラウズなど）ときは null（記録は捨てる）
  const storeReady: Promise<ReplayStore | null> = ReplayStore.open().catch(() => null);
  let liveMode: ReplayStart['mode'] | null = null;
  /** 最後に自動保存した記録の id と題（リザルトの「リプレイを保存」） */
  let lastAuto: Promise<number | null> = Promise.resolve(null);
  let lastTitle = '';
  /** takePending で取り出した、これから再生する記録 */
  let playbackData: ReplayData | null = null;

  let list: ReplayListScreen | null = null;
  const say = (text: string): void => {
    list?.say(text);
  };
  const createList = (ui: typeof ReplayUi): ReplayListScreen =>
    new ui.ReplayListScreen(document.body, {
      onPlay: (e) => {
        void play1(e);
      },
      onSave: (e, name) => {
        void withStore(async (s) => {
          const r = await s.save(e.id, name);
          say(
            r === 'full'
              ? t('replay.msg.fullDelete', { max: REPLAY_CONFIG.savedMax })
              : t('replay.msg.saved'),
          );
        });
      },
      onRename: (e, name) => {
        void withStore((s) => s.rename(e.id, name));
      },
      onExport: (e) => {
        void withStore(async (s) => {
          const r = await s.get(e.id);
          if (r)
            ui.downloadReplay(
              r.bytes,
              ui.replayFileName(r.entry.header, e.kind === 'saved' ? e.name : ''),
            );
        });
      },
      onDelete: (e) => {
        const name = e.kind === 'saved' ? e.name : replayTitle(e.header);
        if (!window.confirm(t('replay.msg.confirmDelete', { name }))) return;
        void withStore((s) => s.remove(e.id));
      },
      onImport: () => {
        void importFile(ui);
      },
      onBack: () => game.transition('mode_select'),
    });

  /** 保存の操作をして一覧を入れ直す */
  const withStore = async (fn: (s: ReplayStore) => Promise<unknown>): Promise<void> => {
    const s = await storeReady;
    if (!s) {
      say(t('replay.msg.noStorage'));
      return;
    }
    try {
      await fn(s);
    } catch {
      say(t('replay.msg.opFailed'));
    }
    await refresh();
  };

  const refresh = async (): Promise<void> => {
    const s = await storeReady;
    if (!list) return;
    if (!s) {
      list.update([], { savedCount: 0, savedBytes: 0, autoCount: 0, autoBytes: 0 });
      say(t('replay.msg.noStorage'));
      return;
    }
    list.update(await s.list(), await s.usage());
  };

  const play1 = async (e: ReplayEntry): Promise<void> => {
    const s = await storeReady;
    const r = s ? await s.get(e.id) : null;
    if (!r) return;
    let data: ReplayData;
    try {
      data = decodeReplay(r.bytes);
    } catch {
      say(t('replay.msg.corrupt'));
      return;
    }
    // 9-6c: ネフィルガのレイドは遅延チャンクを読んでから（読めなければ再生しない）
    // 9-7: キャンペーンの M8（ネフィルガの決戦）も
    const kaiju2 =
      needsKaiju2(data.header.raidKaiju) || missionNeedsKaiju2(missionFor(data.header));
    if (kaiju2 && !(await loadKaiju2())) return;
    hub.pending = data;
    game.transition('flight');
  };

  const importFile = async (ui: typeof ReplayUi): Promise<void> => {
    const f = await ui.pickReplayFile();
    if (!f) return;
    try {
      const header = decodeHeader(f.bytes);
      // 中身まで読めるか確かめてから入れる
      decodeReplay(f.bytes);
      await withStore(async (s) => {
        const r = await s.importSaved(header, f.bytes, f.name);
        say(
          r === 'full'
            ? t('replay.msg.full', { max: REPLAY_CONFIG.savedMax })
            : t('replay.msg.imported'),
        );
      });
    } catch {
      say(t('replay.msg.badFile'));
    }
  };

  /** 本番の記録を終えて自動保存する（短すぎる・記録していなければ何もしない） */
  // 中断で防衛戦が捨てられても波数を結果に出せるように、直前の防衛戦を覚えておく（7-C）
  let lastDefense: DefenseRunner | null = null;
  play.onDefenseChange((d) => {
    if (d) lastDefense = d;
  });
  const finishLive = (): void => {
    if (!hub.recorder.active || liveMode === null) return;
    const data = hub.recorder.finish(replayOutcome(play, liveMode, lastDefense));
    lastDefense = null;
    liveMode = null;
    if (!data || data.header.steps < REPLAY_CONFIG.minSeconds * 60) {
      lastAuto = Promise.resolve(null);
      return;
    }
    const bytes = encodeReplay(data);
    lastAuto = storeReady.then((s) => (s ? s.addAuto(data.header, bytes) : null)).catch(() => null);
  };

  // リザルトの「リプレイを保存」
  const boxes = p.resultExtras.map(
    (parent) =>
      new ReplaySaveBox(parent, async (name) => {
        const [s, id] = await Promise.all([storeReady, lastAuto]);
        if (!s || id === null) return t('replay.msg.saveFailed');
        const r = await s.save(id, name);
        if (r === 'full') return t('replay.msg.fullList', { max: REPLAY_CONFIG.savedMax });
        if (r === 'missing') return t('replay.msg.notFound');
        const u = await s.usage();
        return t('replay.msg.savedCount', { count: u.savedCount, max: REPLAY_CONFIG.savedMax });
      }),
  );

  /** 一覧を開く（初回はチャンクを読んでから。読めなければモード選択へ戻る） */
  const openList = async (): Promise<void> => {
    const ui = await p.loadUi();
    if (game.state !== 'replay_select') return;
    if (!ui) {
      game.transition('mode_select');
      return;
    }
    list ??= createList(ui);
    list.setShown(true);
    await refresh();
  };

  game.onChange(({ from, to }) => {
    if (to === 'replay_select') void openList();
    else list?.setShown(false);
    // 飛行から出たら記録を終える（リザルト・中断・メニュー）。再生も終える
    if (inFlight(from) && !inFlight(to)) {
      finishLive();
      playback.stop();
    }
    if (to === 'result') {
      for (const b of boxes) b.reset(lastTitle, false);
      void lastAuto.then((id) => {
        for (const b of boxes) b.reset(lastTitle, id !== null);
      });
    }
  });

  const hooks: FlightReplayHooks = {
    takePending() {
      const d = hub.pending;
      hub.pending = null;
      finishLive();
      playback.stop();
      // 世界を作る前に再生中にする（ミッションの報酬・記録の配線が見る）
      if (d) hub.playing = true;
      playbackData = d;
      return d;
    },
    liveStarted(start) {
      liveMode = start.mode;
      lastTitle = replayTitle(start);
      hub.recorder.begin(start, {
        title: lastTitle,
        pilotName: p.save.pilotName ?? '',
        date: new Date().toISOString(),
        gameVersion: APP_VERSION,
        startHash: simHash(p.world),
        controls: replayControlsOf(p.save.settings.controls, p.input.lastDevice, p.input.steerMode),
      });
      // 9-4: 始めた直後の丸めたハッシュ（再生でずれを見つける。[0]）
      hub.checkpoint(p.world.buildings());
    },
    unrecordedStarted() {
      liveMode = null;
    },
    replayStarted() {
      const d = playbackData;
      if (d) playback.start(d);
    },
  };
  return {
    hooks,
    loop: {
      hub,
      update: () => {
        playback.update();
      },
      stepOnce: () => {
        playback.stepOnce();
      },
    },
  };
}
