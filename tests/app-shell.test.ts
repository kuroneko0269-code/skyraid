import { describe, expect, it } from 'vitest';
import { APP_SHELL_CONFIG } from '../src/data/app';
import { checkInstallHint, isIosSafari, type InstallEnv } from '../src/core/install-hint';
import { SKIP_WAITING_MESSAGE, watchForUpdate, type WorkerLike } from '../src/core/sw-update';
import { logoUrl, resolveLogo } from '../src/ui/brand';

describe('ロゴの受け口（brand.ts）', () => {
  it('画像が読めれば画像、読めなければテキスト', async () => {
    expect(await resolveLogo(() => Promise.resolve(true))).toBe('image');
    expect(await resolveLogo(() => Promise.resolve(false))).toBe('text');
  });

  it('調べる途中で失敗してもテキスト', async () => {
    expect(await resolveLogo(() => Promise.reject(new Error('network')))).toBe('text');
  });

  it('public/brand/logo.png を調べる', async () => {
    const seen: string[] = [];
    await resolveLogo((url) => {
      seen.push(url);
      return Promise.resolve(false);
    });
    expect(seen).toEqual([logoUrl()]);
    expect(logoUrl()).toBe('/brand/logo.png');
  });
});

class FakeWorker implements WorkerLike {
  state = 'installing';
  readonly messages: unknown[] = [];
  private readonly listeners: (() => void)[] = [];
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  setState(state: string): void {
    this.state = state;
    for (const fn of this.listeners) fn();
  }
}

class FakeRegistration {
  waiting: WorkerLike | null = null;
  installing: FakeWorker | null = null;
  private readonly listeners: (() => void)[] = [];
  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.listeners.push(listener);
  }
  /** 新しい SW が見つかってインストールが始まる */
  found(worker: FakeWorker): void {
    this.installing = worker;
    for (const fn of this.listeners) fn();
  }
}

describe('Service Worker の更新検知（sw-update.ts）', () => {
  it('制御中の SW があるとき、新しい SW がインストールを終えたら 1 回だけ知らせる', () => {
    const reg = new FakeRegistration();
    const updates: WorkerLike[] = [];
    watchForUpdate(
      reg,
      () => true,
      (w) => updates.push(w),
    );
    const w = new FakeWorker();
    reg.found(w);
    expect(updates).toHaveLength(0);
    w.setState('installed');
    expect(updates).toEqual([w]);
    // 2 つ目の更新が来ても、このページでは 1 回だけ
    const w2 = new FakeWorker();
    reg.found(w2);
    w2.setState('installed');
    expect(updates).toHaveLength(1);
  });

  it('初めてのインストール（制御中の SW がない）は更新として知らせない', () => {
    const reg = new FakeRegistration();
    const updates: WorkerLike[] = [];
    watchForUpdate(
      reg,
      () => false,
      (w) => updates.push(w),
    );
    const w = new FakeWorker();
    reg.found(w);
    w.setState('installed');
    w.setState('activated');
    expect(updates).toHaveLength(0);
  });

  it('起動時にすでに待機中の SW があればすぐ知らせる', () => {
    const reg = new FakeRegistration();
    const waiting = new FakeWorker();
    waiting.state = 'installed';
    reg.waiting = waiting;
    const updates: WorkerLike[] = [];
    watchForUpdate(
      reg,
      () => true,
      (w) => updates.push(w),
    );
    expect(updates).toEqual([waiting]);
  });

  it('登録の時点でインストール中の SW も追う', () => {
    const reg = new FakeRegistration();
    const w = new FakeWorker();
    reg.installing = w;
    const updates: WorkerLike[] = [];
    watchForUpdate(
      reg,
      () => true,
      (u) => updates.push(u),
    );
    w.setState('installed');
    expect(updates).toEqual([w]);
  });

  it('すぐ切り替えるメッセージは vite-plugin-pwa の SW が受け付ける形', () => {
    expect(SKIP_WAITING_MESSAGE).toEqual({ type: 'SKIP_WAITING' });
  });
});

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function memoryStorage(): Map<string, string> & {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
} {
  const m = new Map<string, string>();
  return Object.assign(m, {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  });
}

describe('「ホーム画面に追加」の案内（install-hint.ts）', () => {
  const safari: InstallEnv = { userAgent: IPHONE_SAFARI, maxTouchPoints: 5, standalone: false };

  it('iOS の Safari だけ（iOS の Chrome・Mac の Safari は除く。iPadOS はタッチ点数で判定）', () => {
    expect(isIosSafari(safari)).toBe(true);
    expect(isIosSafari({ ...safari, userAgent: IPHONE_CHROME })).toBe(false);
    expect(isIosSafari({ ...safari, userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
    expect(isIosSafari({ ...safari, userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toBe(true);
  });

  it('2 回目の起動で 1 度だけ出す', () => {
    const s = memoryStorage();
    expect(APP_SHELL_CONFIG.installHint.minLaunches).toBe(2);
    expect(checkInstallHint(safari, s)).toBe(false);
    expect(checkInstallHint(safari, s)).toBe(true);
    expect(checkInstallHint(safari, s)).toBe(false);
    expect(checkInstallHint(safari, s)).toBe(false);
  });

  it('ホーム画面から起動しているとき・ほかのブラウザでは出さない（起動回数は数える）', () => {
    const s = memoryStorage();
    checkInstallHint(safari, s);
    expect(checkInstallHint({ ...safari, standalone: true }, s)).toBe(false);
    expect(checkInstallHint({ ...safari, userAgent: IPHONE_CHROME }, s)).toBe(false);
    expect(s.get(APP_SHELL_CONFIG.installHint.launchKey)).toBe('3');
    expect(checkInstallHint(safari, s)).toBe(true);
  });

  it('保存できない環境では出さない', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => undefined,
    };
    expect(checkInstallHint(safari, broken)).toBe(false);
  });
});
