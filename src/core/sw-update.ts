// Service Worker の更新検知（4-10）。DOM 非依存（ServiceWorkerRegistration と同じ形のものを受け取る）

export interface WorkerLike {
  readonly state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
  postMessage(message: unknown): void;
}

export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

/** 待機中の新しい SW にすぐ切り替えさせるメッセージ（vite-plugin-pwa の prompt 型の SW が受け付ける） */
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

/**
 * 新しいバージョンの SW がインストールを終えて待機に入ったら、onUpdate を 1 回だけ呼ぶ。
 * 起動時にすでに待機中のもの（前回の起動で入った更新）も知らせる。
 * 今のページを制御している SW がない（初めてのインストール）ときは更新ではないので知らせない。
 * 待機中の SW は skipWaiting しないので、全部のタブを閉じた次の起動で差し替わる
 */
export function watchForUpdate(
  registration: RegistrationLike,
  hasController: () => boolean,
  onUpdate: (worker: WorkerLike) => void,
): void {
  let notified = false;
  const notify = (worker: WorkerLike): void => {
    if (notified || !hasController()) return;
    notified = true;
    onUpdate(worker);
  };
  const track = (worker: WorkerLike): void => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') notify(worker);
    });
  };
  if (registration.waiting) notify(registration.waiting);
  if (registration.installing) track(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) track(registration.installing);
  });
}
