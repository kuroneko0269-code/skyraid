// 10-7d: UFO ゼノリスの演出（カメラと見た目だけ。判定・時間・リプレイの結果は変えない）: 登場の場面（空から光の柱の中を降りてきて、
// 光が組み上がる。下から見上げる。ソロのレイドだけ・タップで飛ばす）・段階が変わるときと撃破の揺れ。場面・揺れは共通の kaiju-cinema.ts
import type { PerspectiveCamera } from 'three';
import { xnt } from '../data/xenolith-text';
import { XENOLITH_VISUAL } from '../data/xenolith-visual';
import type { XenolithRaid } from '../missions/xenolith-raid';
import type { FlightFrame } from '../render/flight-frame';
import { KaijuCinema, type KaijuCinemaSubject } from './kaiju-cinema';

const V = XENOLITH_VISUAL;

/** レイドの値を演出が読む形で（毎フレーム今の値を読む） */
export class XenolithSubject implements KaijuCinemaSubject {
  raid: XenolithRaid | null = null;
  private readonly fw = { x: 0, z: -1 };
  private get r(): XenolithRaid {
    if (!this.raid) throw new Error('xenolith cinema: no raid');
    return this.raid;
  }
  get elapsed(): number {
    return this.r.elapsed;
  }
  get phase(): number {
    return this.r.kaiju.stage;
  }
  get dead(): boolean {
    return this.r.dead;
  }
  get position(): Readonly<{ x: number; y: number; z: number }> {
    return this.r.kaiju.body.position;
  }
  get forward(): Readonly<{ x: number; z: number }> {
    const h = this.r.kaiju.body.heading;
    this.fw.x = -Math.sin(h);
    this.fw.z = -Math.cos(h);
    return this.fw;
  }
}

/** 登場の場面の進み（0〜1）から、空の上にいる割合（1 → 0。始めは速く、終わりはゆっくり降りる） */
export function xenolithDescend(progress: number): number {
  const t = Math.max(0, Math.min(1, progress / V.descend.share));
  return (1 - t) ** 3;
}

/** 登場の場面を作る */
export function createXenolithCinema(p: {
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly shake: (strength: number) => void;
}): { cinema: KaijuCinema; subject: XenolithSubject } {
  const subject = new XenolithSubject();
  const cinema = new KaijuCinema(
    {
      parent: document.body,
      frame: p.frame,
      camera: p.camera,
      shake: p.shake,
      roar: () => undefined,
      name: xnt('cinema.name'),
      sub: xnt('cinema.sub'),
      skip: xnt('cinema.skip'),
      theme: 'xenolith',
    },
    V.cinema,
  );
  return { cinema, subject };
}
