// PvP（5-1）の入口。main.ts が静的に読むのはこのファイルだけで、通信（src/net/・peerjs）とロビーは
// PvP を選んだとき・?room のときに import() で別のチャンクとして読む（シングルプレイの読み込みと性能に影響しない）
import { DEFAULT_WEATHER_ID } from '../data/weather';
import type { AircraftDetail } from '../data/aircraft-model';
import type { Loadout } from '../progression/loadout';
import type { CombatInput } from '../combat/combat-input';
import type { AircraftControls } from '../entities/aircraft';
import type { PvpDeps, PvpLink } from './pvp-link';
import type { Screens } from './screens';
import type { GameState } from '../core/game-state';

/** ?room=XXXXXX（部屋コードは pvp-link 側で検査する）。なければ null */
export function parseRoomParam(search: string): string | null {
  const v = new URLSearchParams(search).get('room');
  return v ? v : null;
}

/**
 * 参加用 URL（5-4。共有・QR）: 今のページの URL から ?room=コード を作る。?net=local（確認用）だけは残し、ほかの
 * クエリ（?netdebug など）は落とす
 */
export function buildJoinUrl(href: string, code: string): string {
  const url = new URL(href);
  const local = url.searchParams.get('net') === 'local';
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  if (local) url.searchParams.set('net', 'local');
  return url.toString();
}

/** URL から ?room を消す（5-4。読み込み直しや「ホーム画面に追加」で同じ部屋に入り直さない） */
export function withoutRoomParam(href: string): string {
  const url = new URL(href);
  // URLSearchParams で書き直すと ?netdebug が ?netdebug= になるので、文字列のまま room だけ抜く
  const rest = url.search
    .slice(1)
    .split('&')
    .filter((kv) => kv !== '' && kv.split('=')[0] !== 'room');
  url.search = rest.length > 0 ? `?${rest.join('&')}` : '';
  return url.toString();
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
    private readonly screens: Screens,
    /** URL のクエリ文字列（?room・?netdebug） */
    search: string,
    deps: Omit<PvpDeps, 'aircraftDetail' | 'parent' | 'hangar' | 'debug' | 'transport'> & {
      readonly game: GameState;
      /** パイロット名がまだない（初回起動） */
      readonly needsPilotName: () => boolean;
    },
  ) {
    this.deps = {
      ...deps,
      parent: document.body,
      hangar: screens.hangar,
      debug: parseNetDebug(search),
      transport: parseNetTransport(search),
    };
    this.room = parseRoomParam(search);
    this.needsPilotName = deps.needsPilotName;
    if (this.room) {
      try {
        window.history.replaceState(null, '', withoutRoomParam(window.location.href));
      } catch {
        // 消せなくても参加はできる
      }
    }
    screens.setPvpHandlers({
      onSelect: (raid) => {
        void this.load().then((l) => {
          l.openLobby(undefined, raid);
        });
      },
      onDefense: (mapId, hard) => {
        void this.load().then((l) => {
          l.openLobby(undefined, false, { mapId, hard });
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

  private readonly needsPilotName: () => boolean;

  /**
   * ?room=XXXXXX で直接参加する（起動してタイトルを出した後に呼ぶ。なければ何もしない）。
   * パイロット名が決まっていればロビーへ直行、まだなら名前の入力を挟んでからロビーへ（5-4）
   */
  joinFromUrl(): void {
    const code = this.room;
    if (!code) return;
    const open = (): void => {
      void this.load().then((l) => {
        l.openLobby(code);
      });
    };
    if (!this.needsPilotName()) {
      open();
      return;
    }
    this.screens.setAfterPilotName(open);
    this.deps.game.transition('pilot_name');
  }

  /** PvP の飛行の装備（強化の無効を反映。5-4）。PvP を読んでいなければ null */
  /** 部屋のマップ（6-4） */
  /** ロビーのホスト設定の天候（7-5。未接続なら初期値） */
  get weatherId(): string {
    return this.link?.settings?.weather ?? DEFAULT_WEATHER_ID;
  }

  get mapId(): string {
    return this.link?.settings?.mapId ?? 'island';
  }

  loadout(): Loadout | null {
    return this.link?.loadout() ?? null;
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

  step(controls: Readonly<AircraftControls>, combat: Readonly<CombatInput>, dt: number): void {
    this.link?.step(controls, combat, dt);
  }

  render(alpha: number): void {
    this.link?.render(alpha);
  }

  setAircraftDetail(detail: AircraftDetail): void {
    this.detail = detail;
    this.link?.setAircraftDetail(detail);
  }
}
