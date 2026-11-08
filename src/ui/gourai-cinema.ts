// 10-7c: メカ怪獣ゴウライの演出（カメラと見た目だけ。判定・時間・リプレイの結果は変えない）: 登場の場面（湾の中から浮かび上がり、
// 目が光る。水面の近くから見上げる。ソロのレイドだけ・タップで飛ばす）・段階が変わるときと撃破の揺れ。場面・揺れは共通の kaiju-cinema.ts
import type { PerspectiveCamera } from 'three';
import { grt } from '../data/gourai-text';
import { GOURAI_VISUAL } from '../data/gourai-visual';
import type { GouraiRaid } from '../missions/gourai-raid';
import type { FlightFrame } from '../render/flight-frame';
import { KaijuCinema, type KaijuCinemaSubject } from './kaiju-cinema';

const V = GOURAI_VISUAL;

/** レイドの値を演出が読む形で（毎フレーム今の値を読む） */
export class GouraiSubject implements KaijuCinemaSubject {
  raid: GouraiRaid | null = null;
  private readonly fw = { x: 0, z: -1 };
  private get r(): GouraiRaid {
    if (!this.raid) throw new Error('gourai cinema: no raid');
    return this.raid;
  }
  get elapsed(): number {
    return this.r.elapsed;
  }
  get phase(): number {
    return this.r.kaiju.phase;
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

const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** 登場の場面の進み（0〜1）から、水の下にいる割合（1 → 0）と目の灯り（0 → 1。咆哮の時刻に灯る） */
export function gouraiEntrance(progress: number): { rise: number; eyes: number } {
  const C = V.cinema;
  const lit = C.roarAt / C.seconds;
  return {
    rise: 1 - smooth(progress / V.rise.share),
    eyes: Math.max(0, Math.min(1, (progress - lit) / 0.14)),
  };
}

/** 登場の場面を作る */
export function createGouraiCinema(p: {
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly shake: (strength: number) => void;
}): { cinema: KaijuCinema; subject: GouraiSubject } {
  const subject = new GouraiSubject();
  const cinema = new KaijuCinema(
    {
      parent: document.body,
      frame: p.frame,
      camera: p.camera,
      shake: p.shake,
      roar: () => undefined,
      name: grt('cinema.name'),
      sub: grt('cinema.sub'),
      skip: grt('cinema.skip'),
      theme: 'gourai',
    },
    V.cinema,
  );
  return { cinema, subject };
}
