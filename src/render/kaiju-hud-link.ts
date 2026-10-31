// 怪獣の HUD に渡す値（6-2）: シングルプレイはミッションの怪獣・ロック中の部位・自機のスタン。
// 協力（PvP のロビーから）は表示元を差し替える（ホストの状態の写し）
import { KaijuPart } from '../entities/kaiju-part';
import type { FlightSession } from '../missions/flight-session';
import type { Hud } from '../ui/hud';
import type { KaijuHud, KaijuHudFrame } from '../ui/kaiju-hud';

interface MutableFrame {
  body: KaijuHudFrame['body'];
  locked: KaijuHudFrame['locked'];
  stun: number;
}

export class KaijuHudLink {
  private source: (() => KaijuHudFrame) | null = null;
  private readonly frame: MutableFrame = { body: null, locked: null, stun: 0 };

  constructor(
    private readonly kaijuHud: KaijuHud,
    private readonly hud: Hud,
    private readonly session: FlightSession,
  ) {}

  /** 表示元を差し替える（null でミッションの怪獣） */
  setSource(source: (() => KaijuHudFrame) | null): void {
    this.source = source;
  }

  /** 描画フレームごと（飛行中） */
  update(): void {
    this.kaijuHud.setShown(this.hud.visible);
    if (this.source) {
      this.kaijuHud.update(this.source());
      return;
    }
    const s = this.session;
    const k = s.props.kaiju;
    const f = this.frame;
    f.body = k.visible ? k : null;
    const sel = s.combat.targeting.selected;
    f.locked = sel instanceof KaijuPart ? sel : null;
    f.stun = s.kaijuExposure.stun;
    this.kaijuHud.update(f);
  }
}
