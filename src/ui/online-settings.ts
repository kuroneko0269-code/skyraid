// ポーズメニューの設定「オンライン連携」（7-4）: 状態（未連携 / 承認待ち / 連携中 / エラー）、メール → 6 桁のコード → ログイン、
// 表示名、オンライン連携の ON/OFF（OFF は送信・同期・ランキングを止める。ログインは保持）、ログアウト。
// 環境変数が無いとき（オフライン）はこのセクション自体を作らない（ui/online-link.ts）
import './online.css';
import { errorMessage } from '../online/messages';
import { isEmail, normalizeCode } from '../online/format';
import type { OnlineService, OnlineStatus } from '../online/service';
import { el } from './hud-dom';
import { isolateKeys } from './pilot-name';
import { createToggleButton } from './mobile';

const STATE_LABELS = {
  signedOut: '未連携',
  pending: '承認待ち',
  linked: '連携中',
  error: 'エラー',
} as const;

function button(parent: HTMLElement, label: string): HTMLButtonElement {
  const b = el('button', 'ui-toggle settings-item settings-button', parent, label);
  b.type = 'button';
  return b;
}

function field(parent: HTMLElement, type: string, placeholder: string): HTMLInputElement {
  const f = el('input', 'ui-field online-field', parent);
  f.type = type;
  f.placeholder = placeholder;
  f.spellcheck = false;
  isolateKeys(f);
  return f;
}

/** セクションを作る。before があればその前に（セーブデータの欄の上） */
export function createOnlineSettings(
  panel: HTMLElement,
  service: OnlineService,
  before: Element | null,
): { readonly say: (text: string) => void } {
  const box = document.createElement('div');
  box.className = 'save-settings online-settings';
  panel.insertBefore(box, before);
  el('div', 'save-settings-heading', box, 'オンライン連携');
  const state = el('div', 'online-state', box);
  const note = el('div', 'save-settings-status online-note', box);

  // 未連携: メール → コード
  const signIn = el('div', 'online-form', box);
  const email = field(signIn, 'email', 'メールアドレス');
  email.autocomplete = 'email';
  const sendRow = el('div', 'save-settings-row', signIn);
  const send = button(sendRow, 'コードを送る');
  const codeRow = el('div', 'online-form', box);
  const code = field(codeRow, 'text', '6 桁のコード');
  code.inputMode = 'numeric';
  code.autocomplete = 'one-time-code';
  code.maxLength = 12;
  const verifyRow = el('div', 'save-settings-row', codeRow);
  const verify = button(verifyRow, 'ログイン');
  const resend = button(verifyRow, 'メールを入れ直す');

  // 承認待ち: 案内・再確認
  const pendingRow = el('div', 'save-settings-row', box);
  const recheck = button(pendingRow, '承認を再確認');

  // 連携中: 表示名
  const nameRow = el('div', 'online-form', box);
  const name = field(nameRow, 'text', '表示名（1〜16 文字。ランキングに出ます）');
  name.maxLength = 32;
  const nameButtons = el('div', 'save-settings-row', nameRow);
  const saveName = button(nameButtons, '表示名を保存');

  const toggle = createToggleButton(box, 'オンライン連携', service.status.enabled, () => {
    service.setEnabled(!service.status.enabled);
    return service.status.enabled;
  });
  const signOut = button(box, 'ログアウト');

  let codeSentTo: string | null = null;
  let message = '';
  const say = (text: string): void => {
    message = text;
    note.textContent = text;
    note.hidden = text === '';
  };

  const render = (s: OnlineStatus): void => {
    const signedIn = s.state === 'pending' || s.state === 'linked' || s.userId !== null;
    state.textContent = `状態: ${STATE_LABELS[s.state]}${s.state === 'linked' && !s.enabled ? '（OFF: 送信・同期・ランキングを停止中）' : ''}`;
    state.dataset.state = s.state;
    signIn.hidden = signedIn || codeSentTo !== null;
    codeRow.hidden = signedIn || codeSentTo === null;
    pendingRow.hidden = s.state !== 'pending';
    nameRow.hidden = !(s.state === 'linked' && s.enabled);
    toggle.button.hidden = !signedIn;
    toggle.sync(s.enabled);
    signOut.hidden = !signedIn;
    if (s.state === 'pending')
      say(`管理者に承認を依頼してください（ログイン中: ${s.email ?? ''}）`);
    else if (s.state === 'error') say(errorMessage(s.error ?? 'unknown'));
    else if (message.startsWith('管理者に承認')) say('');
  };

  send.addEventListener('click', () => {
    const v = email.value.trim();
    if (!isEmail(v)) {
      say('メールアドレスを確かめてください');
      return;
    }
    send.disabled = true;
    say('送信中…');
    service
      .sendCode(v)
      .then(
        () => {
          codeSentTo = v;
          code.value = '';
          say(
            `${v} に 6 桁のコードを送りました。メールのコードを入力してください（メールにリンクしか無いときは、そのリンクを開いても連携できます）`,
          );
          render(service.status);
          code.focus({ preventScroll: true });
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        send.disabled = false;
      });
  });

  verify.addEventListener('click', () => {
    const c = normalizeCode(code.value);
    if (codeSentTo === null) return;
    if (c === null) {
      say('6 桁の数字を入力してください');
      return;
    }
    verify.disabled = true;
    say('確認中…');
    service
      .verifyCode(codeSentTo, c)
      .then(
        () => {
          codeSentTo = null;
          say('');
          render(service.status);
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        verify.disabled = false;
      });
  });

  resend.addEventListener('click', () => {
    codeSentTo = null;
    say('');
    render(service.status);
  });

  recheck.addEventListener('click', () => {
    recheck.disabled = true;
    void service.recheck().finally(() => {
      recheck.disabled = false;
      if (service.status.state === 'pending')
        say('まだ承認されていません。管理者に承認を依頼してください');
    });
  });

  saveName.addEventListener('click', () => {
    saveName.disabled = true;
    service
      .setDisplayName(name.value)
      .then(
        (clean) => {
          if (clean === null) say('表示名は 1〜16 文字で入力してください');
          else {
            name.value = clean;
            say('表示名を保存しました');
          }
        },
        (e: unknown) => {
          say(errorMessage(e));
        },
      )
      .finally(() => {
        saveName.disabled = false;
      });
  });

  signOut.addEventListener('click', () => {
    void service.signOut().catch(() => undefined);
    say('ログアウトしました（このページのセーブはそのまま残ります）');
  });

  service.onStatus((s) => {
    render(s);
    // 表示名（入力中は書き換えない）
    if (document.activeElement !== name) name.value = service.profileName ?? '';
  });
  render(service.status);
  return { say };
}
