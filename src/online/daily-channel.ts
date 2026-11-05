// 日替わりチャレンジ（9-9）とオンライン連携のつなぎ（DOM・Supabase 非依存）: ゲームの側（ui/daily-link.ts）は記録の後に flush を呼び、
// 画面はここからランキングを読むだけ。オンライン連携を読み込んだとき（環境変数があるときだけ）に送り先がつながる。
// つながっていなければ何もしない（オフラインでも遊べ、記録はセーブに「未送信」のまま残る）
import type { DailyRankingRow, DailySource } from './daily-scores';

export interface DailyChannelTarget {
  /** 送ってよい（連携中で ON・サーバーの準備ができている） */
  readonly active: boolean;
  flush(): Promise<void>;
  ranking(day: string, spec: string): Promise<readonly DailyRankingRow[]>;
  /** 自分のユーザー id（ランキングで自分の行を目立たせる） */
  readonly selfId: string | null;
}

export class DailyChannel {
  private target: DailyChannelTarget | null = null;
  private readonly listeners: (() => void)[] = [];
  private src: DailySource = { unsent: () => [], markSent: () => undefined };

  /** 送るものの出どころ（セーブ。ui/daily-link.ts が差し込む） */
  setSource(s: DailySource): void {
    this.src = s;
  }

  /** 送り先が読む出どころ（差し込まれる前に作られても、いつも今の出どころを読む） */
  readonly source: DailySource = {
    unsent: () => this.src.unsent(),
    markSent: (day, value) => {
      this.src.markSent(day, value);
    },
  };

  /** オンライン連携を読み込んだ（環境変数があり、送り先がつながった） */
  get connected(): boolean {
    return this.target !== null;
  }

  connect(t: DailyChannelTarget): void {
    this.target = t;
    this.changed();
  }

  /** 連携の状態が変わった（画面のランキングの欄を出し直す） */
  changed(): void {
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  /** ランキングを出せるか */
  get active(): boolean {
    return this.target?.active === true;
  }

  get selfId(): string | null {
    return this.target?.selfId ?? null;
  }

  /** まだ送っていない最高を送る（つながっていなければ何もしない） */
  flush(): Promise<void> {
    return this.target?.flush() ?? Promise.resolve();
  }

  ranking(day: string, spec: string): Promise<readonly DailyRankingRow[]> {
    return this.target?.ranking(day, spec) ?? Promise.resolve([]);
  }
}

export const dailyChannel = new DailyChannel();
