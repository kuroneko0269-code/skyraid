// 傾き操作（9-4）の DOM の側: deviceorientation を読み、TiltReader（src/core/tilt.ts）でスティックの値にして
// Input.directStick に書く（「方向へ倒す」の組み立てはスティックと同じ）。iOS の許可（DeviceOrientationEvent.requestPermission）は
// ボタン操作（クリック）の中で求める。値が来なければ「この端末では傾きを読めない」
import { TILT_CONFIG } from '../data/steer';
import type { Input } from '../core/input';
import { TiltReader } from '../core/tilt';

/** 傾きを使い始めた結果: 使える / 許可されなかった / 値が来ない（センサーが無い・http など） / ボタン操作の中で求め直す */
export type TiltResult = 'ok' | 'denied' | 'unsupported' | 'needsGesture';

interface PermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

function orientationApi(): (typeof DeviceOrientationEvent & PermissionApi) | null {
  return typeof DeviceOrientationEvent === 'undefined' ? null : DeviceOrientationEvent;
}

/** 画面の向き（度）。screen.orientation が無い古い iOS は window.orientation */
function currentScreenAngle(): number {
  const so = typeof screen === 'undefined' ? undefined : screen.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy: unknown = (window as unknown as { orientation?: unknown }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

export class TiltSource {
  readonly reader = new TiltReader();
  /** 値を受け取って使える状態か */
  private readyValue = false;
  private listening = false;
  private granted = false;
  /** 飛行中で、傾きの方式のとき（Input に書く） */
  private activeValue = false;
  private probe: { resolve: (r: TiltResult) => void; timer: number } | null = null;
  /** ready が変わったとき（方式を効かせ直す） */
  onReadyChange: (() => void) | null = null;

  constructor(private readonly input: Input) {}

  /** 傾きを選べる端末か: DeviceOrientationEvent があり、タッチの端末（pointer: coarse）。PC には出さない */
  static usable(): boolean {
    if (orientationApi() === null || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  }

  get ready(): boolean {
    return this.readyValue;
  }

  /** 許可を求めるのにボタン操作が要るか（iOS で、まだ許可されていない） */
  get needsPermission(): boolean {
    return typeof orientationApi()?.requestPermission === 'function' && !this.granted;
  }

  /** 飛行中で傾きの方式か。false の間は Input に書かない */
  setActive(active: boolean): void {
    this.activeValue = active;
  }

  /** 次の値を中立にする（飛び始め・合わせ直し） */
  calibrate(): void {
    this.reader.calibrate();
  }

  /**
   * 使い始める。fromGesture はクリックなどのボタン操作の中から呼んだか（iOS の許可はその中でしか求められない）。
   * 最初の値が来たら 'ok'
   */
  async enable(fromGesture: boolean): Promise<TiltResult> {
    const api = orientationApi();
    if (!api) return 'unsupported';
    if (this.needsPermission) {
      if (!fromGesture) return 'needsGesture';
      try {
        const r = await api.requestPermission?.();
        if (r !== 'granted') return 'denied';
      } catch {
        return 'denied';
      }
      this.granted = true;
    }
    if (this.readyValue) return 'ok';
    this.listen();
    return new Promise<TiltResult>((resolve) => {
      if (this.probe) {
        window.clearTimeout(this.probe.timer);
        this.probe.resolve('unsupported');
      }
      const timer = window.setTimeout(() => {
        this.probe = null;
        this.disable();
        resolve('unsupported');
      }, TILT_CONFIG.probeSeconds * 1000);
      this.probe = { resolve, timer };
    });
  }

  /** やめる（ほかの方式を選んだ・使えなかった） */
  disable(): void {
    if (this.listening) window.removeEventListener('deviceorientation', this.onOrientation);
    this.listening = false;
    this.reader.reset();
    this.setReady(false);
  }

  /**
   * 次のボタン操作（クリック・タップ）で enable(true) する（iOS で、起動時に傾きの方式が保存されていたとき）。
   * 結果は done へ
   */
  enableOnNextGesture(done: (r: TiltResult) => void): void {
    const once = (): void => {
      document.removeEventListener('click', once, true);
      document.removeEventListener('touchend', once, true);
      void this.enable(true).then(done);
    };
    document.addEventListener('click', once, true);
    document.addEventListener('touchend', once, true);
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.reader.reset();
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  private setReady(ready: boolean): void {
    if (ready === this.readyValue) return;
    this.readyValue = ready;
    this.onReadyChange?.();
  }

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    if (!this.reader.read(e.beta, e.gamma, currentScreenAngle(), e.timeStamp)) {
      if (!this.reader.received) return;
    }
    if (this.probe) {
      window.clearTimeout(this.probe.timer);
      const p = this.probe;
      this.probe = null;
      this.setReady(true);
      p.resolve('ok');
    } else if (!this.readyValue) this.setReady(true);
    if (this.activeValue) this.input.setDirectStick(this.reader.value.x, this.reader.value.y);
  };
}
