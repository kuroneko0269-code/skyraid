// 「どちらのセーブを使うか」のダイアログ（7-4）: ローカルとサーバーの両方に変更があるときだけ出す（メニューの間だけ）。
// それぞれのパイロット名・クレジット・クリア数・更新日時を並べ、新しい方に印を付ける
import './online.css';
import { t } from '../core/i18n';
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
    el('h3', 'ui-heading mode-prompt-title', box, t('sync.title'));
    el('p', 'mode-prompt-text', box, t('sync.text'));
    const newer = newerSide(localAt, server.updatedAt);
    const cols = el('div', 'online-sync-cols', box);
    const card = (title: string, data: unknown, at: string | null, isNewer: boolean): void => {
      const c = el('div', 'online-sync-card', cols);
      el('div', 'online-sync-title', c, isNewer ? t('sync.newer', { title }) : title);
      const s = summarizeSave(data);
      el('div', 'online-sync-line', c, t('sync.pilot', { name: s.pilot }));
      el('div', 'online-sync-line', c, s.credits);
      el('div', 'online-sync-line', c, s.cleared);
      el('div', 'online-sync-line', c, t('sync.updated', { time: formatDateTime(at) }));
    };
    card(t('sync.local'), local, localAt, newer === 'local');
    card(t('sync.server'), server.data, server.updatedAt, newer === 'server');
    const buttons = el('div', 'campaign-buttons', box);
    const done = (choice: ConflictChoice): void => {
      wrap.remove();
      resolve(choice);
    };
    createButton(buttons, 'ui-button is-ghost campaign-back', t('sync.later'), () => {
      done(null);
    });
    createButton(buttons, 'ui-button campaign-go', t('sync.useLocal'), () => {
      done('local');
    });
    const serverButton = createButton(
      buttons,
      'ui-button campaign-go is-primary',
      t('sync.useServer'),
      () => {
        done('server');
      },
    );
    serverButton.focus({ preventScroll: true });
  });
}
