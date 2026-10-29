/**
 * 型付きのイベントバス。Events はイベント名 → ペイロードの型の対応表。
 * 例: `new EventBus<{ 'state:change': StateChange }>()`
 */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, ((payload: never) => void)[]>();

  /** 購読する。戻り値で購読解除 */
  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /** 登録順に同期で呼ぶ。呼んでいる途中の登録・解除は次回の emit から反映 */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const fn of [...list]) (fn as (payload: Events[K]) => void)(payload);
  }
}
