/** 起動時に待つ読み込み処理（アセット等）。進捗は 0〜1 */
export interface BootTask {
  readonly label: string;
  run(): Promise<void>;
}

/**
 * 起動シーケンス。タスクを順に待ち、1 つ終わるごとに進捗（完了数 / 総数）を通知する。
 * アセットはまだ無いので、今はタスク 0 個で即完了（進捗 1 を 1 回通知）
 */
export async function runBoot(
  tasks: readonly BootTask[],
  onProgress: (progress: number, label: string) => void = () => undefined,
): Promise<void> {
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task) continue;
    onProgress(i / tasks.length, task.label);
    await task.run();
  }
  onProgress(1, '');
}

/** 起動時に読み込むもの。アセット（glb・テクスチャ・音）が入ったらここに足す */
export const BOOT_TASKS: readonly BootTask[] = [];
