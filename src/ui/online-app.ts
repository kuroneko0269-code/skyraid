// オンライン連携（7-4）の組み立て。ui/online-link.ts が環境変数のあるときだけ動的 import で読み込む:
// Supabase のクライアント・セーブの同期（保存イベント → 3 秒後に送信、起動時とログイン時に受け取り）・記録の送信・
// 設定の「オンライン連携」・モード選択の「ランキング」・競合のダイアログ
import { getBrowserStorage } from '../core/settings';
import type { ScreenState } from '../core/game-state';
import { SAVE_CONFIG } from '../data/save';
import type { OnlineEnv } from '../online/env';
import { SYNC_TEXT } from '../online/messages';
import { recordOutbox } from '../online/outbox';
import { OnlineService } from '../online/service';
import { SupabaseBackend } from '../online/supabase-backend';
import type { SaveAccess, SyncHooks } from '../online/sync';
import type { OnlineLinkParts } from './online-link';
import { createOnlineSettings } from './online-settings';
import { RankingScreen } from './ranking-screen';
import { showToast } from './save-link';
import { setScreenShown } from './screen';
import { askSaveChoice } from './sync-dialog';

/** セーブの反映（ページの読み込み直し）と競合のダイアログを出してよい画面。飛行・ロビーの途中では出さない */
const SAFE_STATES: readonly ScreenState[] = ['title', 'mode_select'];
const TOAST_SECONDS = 4;

export function startOnline(env: OnlineEnv, p: OnlineLinkParts): void {
  const { game, screens, save } = p;
  const modeSelect = screens.modeSelect;

  // 飛行中なら、メニューへ戻るまで待ってから呼ぶ
  const waiting: (() => void)[] = [];
  const whenSafe = (fn: () => void): void => {
    if (SAFE_STATES.includes(game.state)) fn();
    else waiting.push(fn);
  };
  game.onChange(({ to }) => {
    if (!SAFE_STATES.includes(to)) return;
    for (const fn of waiting.splice(0)) fn();
  });

  const access: SaveAccess = {
    data: () => save.snapshot,
    version: SAVE_CONFIG.version,
    apply: (data) => save.replaceWith(data),
    reload: () => {
      window.location.reload();
    },
  };
  let say: (text: string) => void = () => undefined;
  const hooks: SyncHooks = {
    ask: (local, localAt, server) => askSaveChoice(document.body, local, localAt, server),
    whenSafe,
    report: (event) => {
      const text = SYNC_TEXT[event];
      if (text === '') return;
      say(text);
      showToast(document.body, text, TOAST_SECONDS);
    },
  };
  const service = new OnlineService(
    new SupabaseBackend(env),
    getBrowserStorage(),
    access,
    hooks,
    () => save.pilotName ?? SAVE_CONFIG.defaultPilotName,
  );
  save.onPersist(() => {
    service.localSaved();
  });
  recordOutbox.connect((r) => {
    service.submitRecord(r);
  });

  // 設定の「オンライン連携」（セーブデータの欄の上）
  const panel = screens.pause.settings;
  say = createOnlineSettings(panel, service, panel.querySelector('.save-settings')).say;

  // ランキング: モード選択の上に重ねる
  const ranking = new RankingScreen(
    document.body,
    {
      ranking: (q) => service.ranking(q),
      get selfId() {
        return service.status.userId;
      },
    },
    () => {
      const back = game.state === 'mode_select';
      setScreenShown(modeSelect.root, back);
      if (back) modeSelect.setShown(true);
    },
  );
  screens.onRanking = () => {
    if (!service.rankingAvailable) return;
    setScreenShown(modeSelect.root, false);
    ranking.show();
  };
  modeSelect.addOverlay(() => ranking.close());
  game.onChange(({ to }) => {
    if (to !== 'mode_select' && ranking.isOpen) ranking.hide();
  });
  service.onStatus(() => {
    const available = service.rankingAvailable;
    modeSelect.setModeVisible('ranking', available);
    if (!available) ranking.close();
  });

  void service.start();
}
