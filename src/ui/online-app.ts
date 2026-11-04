// オンライン連携（7-4）の組み立て。ui/online-link.ts が環境変数のあるときだけ動的 import で読み込む:
// Supabase のクライアント・セーブの同期（保存イベント → 3 秒後に送信、起動時とログイン時に受け取り）・記録の送信・
// 設定の「オンライン連携」・モード選択の「ランキング」・競合のダイアログ
import { t } from '../core/i18n';
import { getBrowserStorage } from '../core/settings';
import type { ScreenState } from '../core/game-state';
import { SAVE_CONFIG } from '../data/save';
import type { OnlineEnv } from '../online/env';
import { MemberAdmin } from '../online/member-admin';
import { errorMessage, SYNC_TEXT } from '../online/messages';
import { recordOutbox } from '../online/outbox';
import { OnlineService } from '../online/service';
import { SupabaseBackend } from '../online/supabase-backend';
import type { SaveAccess, SyncHooks } from '../online/sync';
import type { OnlineLinkParts } from './online-link';
import { createMemberSettings } from './member-settings';
import { createOnlineSettings } from './online-settings';
import { RankingScreen } from './ranking-screen';
import { showToast } from './save-link';
import { setPilotRenameHook } from './pilot-rename';
import { setServerBackupOption } from './save-settings';
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
    locked: () => save.isLocked,
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
      // 端末のセーブが新しい版のお知らせは起動時に出している（save-link.ts）。設定の欄にだけ書く
      if (event !== 'localTooNew') showToast(document.body, text, TOAST_SECONDS);
    },
  };
  const backend = new SupabaseBackend(env);
  const service = new OnlineService(
    backend,
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

  // 設定の「オンライン連携」と「メンバー管理」（owner だけ。7-4b）（セーブデータの欄の上）
  const panel = screens.settings.slot('data');
  // 8-6d: セーブデータの欄（.save-data）の前に。それまでは最初の .save-settings（8-1 から先頭にあるパイロット名の欄）の前に
  // 入っていたので、データのタブの 2 列で、オンライン連携の欄の「今の名前」とパイロット名の欄が同じ段に並んでいた
  const saveBox = panel.querySelector('.save-data');
  say = createOnlineSettings(panel, service, saveBox).say;
  const members = createMemberSettings(
    panel,
    new MemberAdmin(backend, () => service.status.owner),
    saveBox,
  );
  // 8-6: パイロット名（= サーバーの表示名）を変えたら、メンバー管理の自分の行も直す
  service.onStatus((s) => {
    members.update(s, service.profileName);
  });

  // 「セーブデータを削除」の「サーバーのバックアップも削除する」（7-4b）
  setServerBackupOption({
    canDelete: () => service.activeUserId !== null,
    deleteServer: () =>
      service.sync.deleteServer().then(
        () => null,
        (e: unknown) => errorMessage(e),
      ),
    keepServer: () => {
      service.sync.preferServerOnce();
    },
  });

  // 設定の「パイロット名を変更」（8-1 の事前修正）: 承認済みならサーバーの表示名も変える
  setPilotRenameHook((name) =>
    service.renameFromPilot(name).then((result) => {
      if (result === 'saved') return t('online.rename.saved');
      if (result === 'none') return null;
      return service.status.enabled ? t('online.rename.failed') : t('online.rename.whenEnabled');
    }),
  );

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

  members.update(service.status, service.profileName);
  void service.start();
}
