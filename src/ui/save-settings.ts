// ポーズメニューの設定の最下部「セーブデータ」（3-1）: コピー（エクスポート）/ 貼り付けて復元（インポート）/ 削除（2 段階確認）。
// 復元と削除はページを読み込み直して、すべての設定・進み具合を新しいセーブから読み直す。
// 7-4b: オンライン連携があるときは、削除の確認に「サーバーのバックアップも削除する」（既定 OFF）を出す
import './save.css';
import type { SaveStore } from '../progression/save-store';
import { t } from '../core/i18n';
import { el } from './hud-dom';
import { isolateKeys } from './pilot-name';

/** サーバーのバックアップの扱い（7-4b）。オンライン連携（動的 import）が読み込まれたときに渡される */
export interface ServerBackupOption {
  /** 今サーバーのバックアップを消せるか（連携中かつ ON） */
  canDelete(): boolean;
  /** サーバーのバックアップを消す。成功で null、失敗なら画面に出す一言 */
  deleteServer(): Promise<string | null>;
  /** 残す: 次の同期ではサーバーを上書きせず、サーバーのセーブを 1 回だけ受け取る */
  keepServer(): void;
}

let backupOption: ServerBackupOption | null = null;

/** オンライン連携から呼ぶ（ui/online-app.ts） */
export function setServerBackupOption(option: ServerBackupOption): void {
  backupOption = option;
}

/** 復元・削除の後はページを読み込み直す（既定）。テストなどで差し替えられる */
export function createSaveSettings(
  panel: HTMLElement,
  save: SaveStore,
  onReplaced: () => void = () => {
    window.location.reload();
  },
): void {
  const box = el('div', 'save-settings save-data', panel);
  el('div', 'save-settings-heading', box, t('save.heading'));
  const row = el('div', 'save-settings-row', box);
  const copy = button(row, t('save.copy'));
  const paste = button(row, t('save.paste'));
  const status = el('div', 'save-settings-status', box);
  status.hidden = true;

  // 文字列の表示・入力欄（コピーできなかったときの手動コピーと、復元の貼り付けに使う）
  const area = el('textarea', 'ui-field save-settings-text', box);
  area.rows = 3;
  area.spellcheck = false;
  area.hidden = true;
  isolateKeys(area);
  const restoreRow = el('div', 'save-settings-row', box);
  restoreRow.hidden = true;
  const restore = button(restoreRow, t('save.restore'));
  const cancelRestore = button(restoreRow, t('save.cancel'));

  // 削除（2 段階確認）
  const remove = button(box, t('save.delete'), 'is-danger save-settings-danger');
  const confirmBox = el('div', 'save-settings-confirm', box);
  confirmBox.hidden = true;
  el('div', 'save-settings-warning', confirmBox, t('save.deleteWarning'));
  // サーバーのバックアップ（オンライン連携があるときだけ出す）
  const backupLabel = el('label', 'save-settings-check', confirmBox);
  backupLabel.hidden = true;
  const backupCheck = el('input', 'save-settings-checkbox', backupLabel);
  backupCheck.type = 'checkbox';
  el('span', '', backupLabel, t('save.deleteServerToo'));
  const backupNote = el('div', 'save-settings-status', confirmBox);
  backupNote.hidden = true;
  const syncBackupNote = (): void => {
    const opt = backupOption;
    backupLabel.hidden = opt === null;
    backupNote.hidden = opt === null;
    if (!opt) return;
    const can = opt.canDelete();
    backupCheck.disabled = !can;
    if (!can) backupCheck.checked = false;
    backupNote.textContent = backupCheck.checked
      ? t('save.serverDeleted')
      : can
        ? t('save.serverKept')
        : t('save.serverKeptOffline');
  };
  backupCheck.addEventListener('change', syncBackupNote);
  const confirmRow = el('div', 'save-settings-row', confirmBox);
  const confirmRemove = button(
    confirmRow,
    t('save.confirmDelete'),
    'is-danger save-settings-danger',
  );
  const cancelRemove = button(confirmRow, t('save.cancel'));

  const say = (text: string): void => {
    status.textContent = text;
    status.hidden = text === '';
  };
  const closeRestore = (): void => {
    area.hidden = true;
    area.readOnly = false;
    area.value = '';
    restoreRow.hidden = true;
  };

  copy.addEventListener('click', () => {
    const text = save.exportString();
    closeRestore();
    const showManual = (): void => {
      area.hidden = false;
      area.readOnly = true;
      area.value = text;
      area.select();
      say(t('save.copyFailed'));
    };
    // 安全でない接続（http）などでは clipboard がなく例外になる。そのときは手動でコピーしてもらう
    try {
      navigator.clipboard.writeText(text).then(() => {
        say(t('save.copied'));
      }, showManual);
    } catch {
      showManual();
    }
  });

  paste.addEventListener('click', () => {
    say(t('save.pasteHint'));
    area.hidden = false;
    area.readOnly = false;
    area.value = '';
    restoreRow.hidden = false;
    area.focus({ preventScroll: true });
  });
  cancelRestore.addEventListener('click', () => {
    closeRestore();
    say('');
  });
  restore.addEventListener('click', () => {
    if (save.importString(area.value)) {
      say(t('save.restored'));
      onReplaced();
    } else {
      say(t('save.restoreFailed'));
    }
  });

  remove.addEventListener('click', () => {
    remove.hidden = true;
    confirmBox.hidden = false;
    backupCheck.checked = false;
    syncBackupNote();
  });
  cancelRemove.addEventListener('click', () => {
    confirmBox.hidden = true;
    remove.hidden = false;
  });
  confirmRemove.addEventListener('click', () => {
    const opt = backupOption;
    if (opt && backupCheck.checked && opt.canDelete()) {
      // サーバーを先に消す。消せなければローカルも消さない（やり直すか、チェックを外して消す）
      confirmRemove.disabled = true;
      say(t('save.deletingServer'));
      void opt.deleteServer().then((error) => {
        confirmRemove.disabled = false;
        if (error !== null) {
          say(t('save.deleteServerFailed', { error }));
          return;
        }
        save.clear();
        onReplaced();
      });
      return;
    }
    opt?.keepServer();
    save.clear();
    onReplaced();
  });
}

function button(parent: HTMLElement, label: string, extra = ''): HTMLButtonElement {
  const b = el('button', `ui-toggle settings-item settings-button ${extra}`.trim(), parent, label);
  b.type = 'button';
  return b;
}
