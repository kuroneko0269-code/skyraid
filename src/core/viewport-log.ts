// v1.0.1: 起動時の測り直し（viewport-nudge.ts）と黒い幕（viewport-cover.ts）の記録。?debug=viewport の表示と点検（ui-audit-device.js）が読む。
// 8-6f までは測った値の記録（fitHistory。最新 10 件）に混ぜていたが、値の行に押し出されて消えることがあり、
// 「幕が出なかった・試みが動かなかった」と「記録が消えた」の区別がつかなかった。別に持ち、件数で押し出さない（起動時だけなので数は少ない）

/** 記録の種類: startup = 見張り（短いのを見つけた・見張りの終わり）、cover = 幕とロゴ、nudge = 測り直しの試み */
export type StartupEventKind = 'startup' | 'cover' | 'nudge';

export interface StartupEvent {
  /** 読み込みからの秒 */
  readonly t: number;
  readonly kind: StartupEventKind;
  readonly text: string;
}

/** 上限（念のため。ふつうは 10 件ほど） */
const MAX_EVENTS = 40;

export const startupEvents: StartupEvent[] = [];

export function noteStartup(kind: StartupEventKind, text: string): void {
  if (startupEvents.length >= MAX_EVENTS) return;
  startupEvents.push({ t: performance.now() / 1000, kind, text });
}

/** 種類ごとに 1 行（「cover   on 1.30s | logo ok 1.42s | off 4.90s (fixed)」）。まだ無ければ '-' */
export function startupSummary(kind: StartupEventKind): string {
  const list = startupEvents.filter((e) => e.kind === kind);
  return list.length === 0 ? '-' : list.map((e) => `${e.text} ${e.t.toFixed(2)}s`).join(' | ');
}
