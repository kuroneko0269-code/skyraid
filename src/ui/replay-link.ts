// リプレイ（7-B）と画面・保存の配線: 本番の飛行の記録の始め・終わり（終わったら IndexedDB に自動保存。直近 10 本）、
// リザルトの「リプレイを保存」（名前を付けて永久保存。30 本まで）、モード選択の「リプレイ」→ 一覧 → 再生、
// .skyreplay の書き出し・読み込み。再生中の操作は ui/replay-playback.ts
import type { GameState } from '../core/game-state';
import { REPLAY_CONFIG } from '../data/replay';
import type { DefenseRunner } from '../missions/defense/runner';
import type { GamePlay } from '../missions/game-play';
import type { SaveStore } from '../progression/save-store';
import { decodeHeader, decodeReplay, encodeReplay } from '../replay/codec';
import type { ReplayHub } from '../replay/hub';
import { replayOutcome, replayTitle } from '../replay/outcome';
import { simHash, type SimWorld } from '../replay/sim';
import { ReplayStore, type ReplayEntry } from '../replay/store';
import type { ReplayData, ReplayStart } from '../replay/types';
import type { FlightReplayHooks } from './flight-start';
import type { FlightLoopReplay } from './flight-loop';
import { downloadReplay, pickReplayFile, replayFileName } from './replay-file';
import { ReplayListScreen } from './replay-list';
import type { ReplayPlayback } from './replay-playback';
import { ReplaySaveBox } from './replay-save';

export interface ReplayLinkParts {
  readonly game: GameState;
  readonly hub: ReplayHub;
  readonly play: GamePlay;
  readonly world: SimWorld;
  readonly save: SaveStore;
  readonly playback: ReplayPlayback;
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

  const list = new ReplayListScreen(document.body, {
    onPlay: (e) => {
      void play1(e);
    },
    onSave: (e, name) => {
      void withStore(async (s) => {
        const r = await s.save(e.id, name);
        list.say(
          r === 'full'
            ? `保存は ${String(REPLAY_CONFIG.savedMax)} 本までです。不要なものを削除してください`
            : '保存しました',
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
          downloadReplay(r.bytes, replayFileName(r.entry.header, e.kind === 'saved' ? e.name : ''));
      });
    },
    onDelete: (e) => {
      if (!window.confirm(`「${e.kind === 'saved' ? e.name : e.header.title}」を削除しますか？`))
        return;
      void withStore((s) => s.remove(e.id));
    },
    onImport: () => {
      void importFile();
    },
    onBack: () => game.transition('mode_select'),
  });

  /** 保存の操作をして一覧を入れ直す */
  const withStore = async (fn: (s: ReplayStore) => Promise<unknown>): Promise<void> => {
    const s = await storeReady;
    if (!s) {
      list.say('このブラウザではリプレイを保存できません（IndexedDB が使えません）');
      return;
    }
    try {
      await fn(s);
    } catch {
      list.say('保存の操作に失敗しました');
    }
    await refresh();
  };

  const refresh = async (): Promise<void> => {
    const s = await storeReady;
    if (!s) {
      list.update([], { savedCount: 0, savedBytes: 0, autoCount: 0, autoBytes: 0 });
      list.say('このブラウザではリプレイを保存できません（IndexedDB が使えません）');
      return;
    }
    list.update(await s.list(), await s.usage());
  };

  const play1 = async (e: ReplayEntry): Promise<void> => {
    const s = await storeReady;
    const r = s ? await s.get(e.id) : null;
    if (!r) return;
    try {
      hub.pending = decodeReplay(r.bytes);
    } catch {
      list.say('このリプレイは壊れていて再生できません');
      return;
    }
    game.transition('flight');
  };

  const importFile = async (): Promise<void> => {
    const f = await pickReplayFile();
    if (!f) return;
    try {
      const header = decodeHeader(f.bytes);
      // 中身まで読めるか確かめてから入れる
      decodeReplay(f.bytes);
      await withStore(async (s) => {
        const r = await s.importSaved(header, f.bytes, f.name);
        list.say(
          r === 'full' ? `保存は ${String(REPLAY_CONFIG.savedMax)} 本までです` : '読み込みました',
        );
      });
    } catch {
      list.say('リプレイのファイルとして読めませんでした');
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
        if (!s || id === null) return '保存できませんでした';
        const r = await s.save(id, name);
        if (r === 'full')
          return `保存は ${String(REPLAY_CONFIG.savedMax)} 本までです（一覧で削除できます）`;
        if (r === 'missing') return '記録が見つかりませんでした';
        const u = await s.usage();
        return `保存しました（${String(u.savedCount)} / ${String(REPLAY_CONFIG.savedMax)}）`;
      }),
  );

  game.onChange(({ from, to }) => {
    list.setShown(to === 'replay_select');
    if (to === 'replay_select') void refresh();
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
        startHash: simHash(p.world),
      });
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
