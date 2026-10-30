// PvP（5-1）の入口。main.ts が静的に読むのはこのファイルだけで、通信（src/net/・peerjs）とロビーは
// PvP を選んだとき・?room のときに import() で別のチャンクとして読む（シングルプレイの読み込みと性能に影響しない）
import type { AircraftDetail } from '../data/aircraft-model';
import type { AircraftControls } from '../entities/aircraft';
import type { PvpDeps, PvpLink } from './pvp-link';
import type { Screens } from './screens';

/** ?room=XXXXXX（部屋コードは pvp-link 側で検査する）。なければ null */
export function parseRoomParam(search: string): string | null {
  const v = new URLSearchParams(search).get('room');
  return v ? v : null;
}

/** ?net=local: PeerJS の代わりに同じブラウザのタブどうしで通信する（1 台の PC で確かめる用） */
export function parseNetTransport(search: string): 'peerjs' | 'local' {
  return new URLSearchParams(search).get('net') === 'local' ? 'local' : 'peerjs';
}

/** ?netdebug: PvP の飛行中に RTT・受信レート・補間遅延を出す */
export function parseNetDebug(search: string): boolean {
  return new URLSearchParams(search).has('netdebug');
}

export class PvpEntry {
  private link: PvpLink | null = null;
  private loading: Promise<PvpLink> | null = null;
  private detail: AircraftDetail = 'high';
  private readonly deps: Omit<PvpDeps, 'aircraftDetail'>;
  private readonly room: string | null;

  constructor(
    screens: Screens,
    /** URL のクエリ文字列（?room・?netdebug） */
    search: string,
    deps: Omit<PvpDeps, 'aircraftDetail' | 'parent' | 'hangar' | 'debug' | 'transport'>,
  ) {
    this.deps = {
      ...deps,
      parent: document.body,
      hangar: screens.hangar,
      debug: parseNetDebug(search),
      transport: parseNetTransport(search),
    };
    this.room = parseRoomParam(search);
    screens.setPvpHandlers({
      onSelect: () => {
        void this.load().then((l) => {
          l.openLobby();
        });
      },
      onBack: () => this.link?.back(),
      onPause: () => this.togglePause(),
    });
  }

  /** PvP の部分を読み込む（2 回目からは読み込み済みのもの） */
  load(): Promise<PvpLink> {
    this.loading ??= import('./pvp-link').then((m) => {
      this.link = m.createPvpLink({ ...this.deps, aircraftDetail: this.detail });
      return this.link;
    });
    return this.loading;
  }

  /** ?room=XXXXXX で直接参加する（起動してタイトルを出した後に呼ぶ。なければ何もしない） */
  joinFromUrl(): void {
    const code = this.room;
    if (!code) return;
    void this.load().then((l) => {
      l.openLobby(code);
    });
  }

  /** PvP の飛行中か（固定ステップと Esc を PvP に回す） */
  get flying(): boolean {
    return this.link?.flying ?? false;
  }

  /** Esc（飛行中）: PvP ならメニューを開閉して true */
  togglePause(): boolean {
    if (!this.flying) return false;
    this.link?.toggleMenu();
    return true;
  }

  beginFlight(): void {
    this.link?.beginFlight();
  }

  step(controls: Readonly<AircraftControls>, dt: number): void {
    this.link?.step(controls, dt);
  }

  render(alpha: number): void {
    this.link?.render(alpha);
  }

  setAircraftDetail(detail: AircraftDetail): void {
    this.detail = detail;
    this.link?.setAircraftDetail(detail);
  }
}
