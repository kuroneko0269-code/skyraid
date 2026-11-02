// 設定の「メンバー管理」（7-4b）: owner（app_metadata.roles.skyraid = 'owner'）のときだけ出す。
// 承認待ちの一覧（承認 / 却下）と承認済みの一覧（取り消し）。承認・却下は 1 タップで確定、取り消しだけ確認のダイアログ。
// 権限はサーバー（SQL の is_owner）が確かめる。ここでの出し分けは見た目だけ
import './online.css';
import { t } from '../core/i18n';
import type { MemberAdmin } from '../online/member-admin';
import { memberLists, type MemberAction, type MemberLine } from '../online/members';
import { errorMessage } from '../online/messages';
import type { OnlineStatus } from '../online/service';
import { el } from './hud-dom';
import { createButton } from './screen';

function smallButton(parent: HTMLElement, label: string, extra = ''): HTMLButtonElement {
  const b = el('button', `ui-toggle settings-button member-button ${extra}`.trim(), parent, label);
  b.type = 'button';
  return b;
}

/** 取り消しの確認（どの画面の上にも出す） */
function confirmRevoke(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = el('div', 'mode-prompt online-sync-dialog', document.body);
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const box = el('div', 'ui-dialog mode-prompt-box', wrap);
    el('h3', 'ui-heading mode-prompt-title', box, t('members.confirmTitle', { name }));
    el('p', 'mode-prompt-text', box, t('members.confirmText'));
    const buttons = el('div', 'campaign-buttons', box);
    const done = (ok: boolean): void => {
      wrap.remove();
      resolve(ok);
    };
    const cancel = createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('members.cancel'),
      () => {
        done(false);
      },
    );
    createButton(buttons, 'ui-button is-danger campaign-go', t('members.confirmRevoke'), () => {
      done(true);
    });
    cancel.focus({ preventScroll: true });
  });
}

/** セクションを作る（オンライン連携の欄の直後）。owner でなければ隠したまま */
export function createMemberSettings(
  panel: HTMLElement,
  admin: MemberAdmin,
  before: Element | null,
): { readonly update: (s: OnlineStatus, selfName: string | null) => void } {
  const box = document.createElement('div');
  box.className = 'save-settings online-settings member-settings';
  box.hidden = true;
  panel.insertBefore(box, before);
  el('div', 'save-settings-heading', box, t('members.heading'));
  const note = el('div', 'save-settings-status online-note', box);
  note.hidden = true;
  const pendingHead = el('div', 'member-heading', box);
  const pendingList = el('div', 'member-list', box);
  const approvedHead = el('div', 'member-heading', box);
  const approvedList = el('div', 'member-list', box);
  const reload = smallButton(box, t('members.reload'), 'settings-item');

  let selfId: string | null = null;
  let loaded = false;
  let busy = false;
  const say = (text: string): void => {
    note.textContent = text;
    note.hidden = text === '';
  };

  const act = async (line: MemberLine, action: MemberAction): Promise<void> => {
    if (busy) return;
    if (action === 'revoke' && !(await confirmRevoke(line.name))) return;
    busy = true;
    render();
    try {
      if (await admin.act(line.userId, action))
        say(t('members.result', { name: line.name, text: t(`members.done.${action}`) }));
    } catch (e) {
      say(t('members.result', { name: line.name, text: errorMessage(e) }));
    } finally {
      busy = false;
      render();
    }
  };

  const row = (parent: HTMLElement, line: MemberLine, actions: readonly MemberAction[]): void => {
    const r = el('div', 'member-row', parent);
    el('span', 'member-name', r, line.self ? t('members.self', { name: line.name }) : line.name);
    el('span', 'member-date', r, line.requested);
    for (const a of actions) {
      const b = smallButton(
        r,
        t(`members.action.${a}`),
        a === 'approve' ? 'is-primary' : 'is-danger',
      );
      b.disabled = busy;
      b.addEventListener('click', () => {
        b.blur();
        void act(line, a);
      });
    }
  };

  function render(): void {
    const lists = memberLists(admin.rows, selfId);
    pendingHead.textContent = t('members.pending', { count: lists.pending.length });
    approvedHead.textContent = t('members.approved', { count: lists.approved.length });
    pendingList.replaceChildren();
    approvedList.replaceChildren();
    if (lists.pending.length === 0) el('div', 'member-empty', pendingList, t('members.empty'));
    for (const l of lists.pending) row(pendingList, l, ['approve', 'reject']);
    for (const l of lists.approved) row(approvedList, l, l.self ? [] : ['revoke']);
    reload.disabled = busy;
  }

  const load = (): void => {
    if (busy) return;
    busy = true;
    say(t('members.loading'));
    render();
    admin
      .load()
      .then(
        () => {
          loaded = true;
          say('');
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        busy = false;
        render();
      });
  };
  reload.addEventListener('click', load);

  /** selfName はサーバーの表示名（= パイロット名。8-6）。変わっていれば自分の行を直す */
  const update = (s: OnlineStatus, selfName: string | null): void => {
    const show = s.owner && s.userId !== null;
    if (s.userId !== selfId) {
      selfId = s.userId;
      loaded = false;
      admin.clear();
    }
    if (selfId !== null && selfName !== null) admin.renameSelf(selfId, selfName);
    box.hidden = !show;
    if (show && !loaded && !busy) load();
    else render();
  };
  render();
  return { update };
}
