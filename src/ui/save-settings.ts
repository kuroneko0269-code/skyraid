// ポーズメニューの設定の最下部「セーブデータ」（3-1）: コピー（エクスポート）/ 貼り付けて復元（インポート）/ 削除（2 段階確認）。
// 復元と削除はページを読み込み直して、すべての設定・進み具合を新しいセーブから読み直す
import './save.css';
import type { SaveStore } from '../progression/save-store';
import { el } from './hud-dom';
import { isolateKeys } from './pilot-name';

/** 復元・削除の後はページを読み込み直す（既定）。テストなどで差し替えられる */
export function createSaveSettings(
  panel: HTMLElement,
  save: SaveStore,
  onReplaced: () => void = () => {
    window.location.reload();
  },
): void {
  const box = el('div', 'save-settings', panel);
  el('div', 'save-settings-heading', box, 'セーブデータ');
  const row = el('div', 'save-settings-row', box);
  const copy = button(row, 'セーブデータをコピー');
  const paste = button(row, '貼り付けて復元');
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
  const restore = button(restoreRow, '復元する');
  const cancelRestore = button(restoreRow, 'やめる');

  // 削除（2 段階確認）
  const remove = button(box, 'セーブデータを削除', 'is-danger save-settings-danger');
  const confirmBox = el('div', 'save-settings-confirm', box);
  confirmBox.hidden = true;
  el(
    'div',
    'save-settings-warning',
    confirmBox,
    '進み具合・クレジット・設定がすべて消えます。元に戻せません',
  );
  const confirmRow = el('div', 'save-settings-row', confirmBox);
  const confirmRemove = button(confirmRow, '削除する', 'is-danger save-settings-danger');
  const cancelRemove = button(confirmRow, 'やめる');

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
      say('コピーできませんでした。下の文字列を選んでコピーしてください');
    };
    // 安全でない接続（http）などでは clipboard がなく例外になる。そのときは手動でコピーしてもらう
    try {
      navigator.clipboard.writeText(text).then(() => {
        say('コピーしました。新しい端末で「貼り付けて復元」に貼り付けてください');
      }, showManual);
    } catch {
      showManual();
    }
  });

  paste.addEventListener('click', () => {
    say('コピーした文字列を貼り付けて「復元する」を押してください（今のデータは上書きされます）');
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
      say('復元しました');
      onReplaced();
    } else {
      say('読み込めませんでした。文字列がすべて貼り付けられているか確かめてください');
    }
  });

  remove.addEventListener('click', () => {
    remove.hidden = true;
    confirmBox.hidden = false;
  });
  cancelRemove.addEventListener('click', () => {
    confirmBox.hidden = true;
    remove.hidden = false;
  });
  confirmRemove.addEventListener('click', () => {
    save.clear();
    onReplaced();
  });
}

function button(parent: HTMLElement, label: string, extra = ''): HTMLButtonElement {
  const b = el('button', `ui-toggle settings-item settings-button ${extra}`.trim(), parent, label);
  b.type = 'button';
  return b;
}
