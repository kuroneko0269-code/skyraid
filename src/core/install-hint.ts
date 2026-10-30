// iOS の「ホーム画面に追加」の案内（4-10）を出すかの判定。DOM 非依存（環境は呼び出し側が渡す）
import { APP_SHELL_CONFIG } from '../data/app';
import type { StorageLike } from './settings';

export interface InstallEnv {
  /** navigator.userAgent */
  readonly userAgent: string;
  /** navigator.maxTouchPoints（iPadOS の Safari は Mac と同じ UA なので、タッチ点数で見分ける） */
  readonly maxTouchPoints: number;
  /** ホーム画面から起動している（navigator.standalone または display-mode: standalone） */
  readonly standalone: boolean;
}

/** iPhone / iPad の Safari か（Chrome・Firefox・Edge などの iOS 版は「ホーム画面に追加」の手順が違うので除く） */
export function isIosSafari(env: InstallEnv): boolean {
  const ua = env.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  return ios && /Safari\//.test(ua) && !otherBrowser;
}

/**
 * 起動を 1 回数え、今回の起動で案内を出すかを返す（出すなら表示済みも記録する）。
 * iOS の Safari・ブラウザで開いている・2 回目以降の起動・まだ出していない、のすべてのとき。
 * 保存できない環境（プライベートモード等）では数えられないので出さない
 */
export function checkInstallHint(env: InstallEnv, storage: StorageLike): boolean {
  const c = APP_SHELL_CONFIG.installHint;
  let launches: number;
  try {
    launches = (Number.parseInt(storage.getItem(c.launchKey) ?? '0', 10) || 0) + 1;
    storage.setItem(c.launchKey, String(launches));
    if (env.standalone || !isIosSafari(env)) return false;
    if (launches < c.minLaunches || storage.getItem(c.shownKey) !== null) return false;
    storage.setItem(c.shownKey, '1');
    return true;
  } catch {
    return false;
  }
}
