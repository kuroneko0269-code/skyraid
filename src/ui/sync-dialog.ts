// 「どちらのセーブを使うか」のダイアログ（7-4）: ローカルとサーバーの両方に変更があるときだけ出す（メニューの間だけ）。
// それぞれのパイロット名・クレジット・クリア数・更新日時を並べ、新しい方に印を付ける
import './online.css';
import type { RemoteSave } from '../online/backend';
import { formatDateTime, summarizeSave } from '../online/format';
import type { ConflictChoice } from '../online/sync';
import { newerSide } from '../online/sync-rules';
import { el } from './hud-dom';
import { createButton } from './screen';

export function askSaveChoice(
  parent: HTMLElement,
  local: unknown,
  localAt: string | null,
  server: RemoteSave,
): Promise<ConflictChoice> {
  return new Promise((resolve) => {
    const wrap = el('div', 'mode-prompt online-sync-dialog', parent);
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const box = el('div', 'ui-dialog mode-prompt-box mode-prompt-wide', wrap);
    el('h3', 'ui-heading mode-prompt-title', box, 'どちらのセーブを使いますか？');
    el(
      'p',
      'mode-prompt-text',
      box,
      'この端末とサーバーの両方で、前回の同期の後にセーブが変わっています。使う方を選んでください。選ばなかった方は上書きされます。',
    );
    const newer = newerSide(localAt, server.updatedAt);
    const cols = el('div', 'online-sync-cols', box);
    const card = (title: string, data: unknown, at: string | null, isNewer: boolean): void => {
      const c = el('div', 'online-sync-card', cols);
      el('div', 'online-sync-title', c, isNewer ? `${title}（新しい）` : title);
      const s = summarizeSave(data);
      el('div', 'online-sync-line', c, `パイロット: ${s.pilot}`);
      el('div', 'online-sync-line', c, s.credits);
      el('div', 'online-sync-line', c, s.cleared);
      el('div', 'online-sync-line', c, `更新: ${formatDateTime(at)}`);
    };
    card('この端末', local, localAt, newer === 'local');
    card('サーバー', server.data, server.updatedAt, newer === 'server');
    const buttons = el('div', 'campaign-buttons', box);
    const done = (choice: ConflictChoice): void => {
      wrap.remove();
      resolve(choice);
    };
    createButton(buttons, 'ui-button is-ghost campaign-back', 'あとで', () => {
      done(null);
    });
    createButton(buttons, 'ui-button campaign-go', 'この端末のセーブ', () => {
      done('local');
    });
    const serverButton = createButton(
      buttons,
      'ui-button campaign-go is-primary',
      'サーバーのセーブ',
      () => {
        done('server');
      },
    );
    serverButton.focus({ preventScroll: true });
  });
}
