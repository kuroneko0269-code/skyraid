// 10-7c: メカ怪獣ゴウライのいつも出る粒（gourai-effects.ts から分けた。描画だけ。乱数は Math.random）: 放熱の蒸気（背の放熱板の
// 間・前の装甲の継ぎ目）・熱が高いときの継ぎ目の蒸気・排気口の熱のゆらぎ・推進器の熱と海面の吹きおろし・壊れた所の煙・撃破の
// 爆発の連鎖と煙・沈む間の蒸気・登場で体から落ちる水
import { Vector3 } from 'three';
import { GOURAI_TARGET_SPHERES, type GouraiPart } from '../../data/gourai';
import { GOURAI_VISUAL, type GouraiTierSpec } from '../../data/gourai-visual';
import type { GouraiKaiju } from '../../ai/gourai-ai';
import type { GouraiViewInput } from './gourai-effects';
import type { GouraiEmit } from './gourai-emit';
import type { GouraiMotion } from './motion';
import { GOURAI_FIN_Z } from './skeleton';

const V = GOURAI_VISUAL;

/** 部位の場所（体の座標。前 −Z・右 +X）。判定の球の真ん中 */
export const GOURAI_PART_AT = new Map<GouraiPart, Vector3>();
for (const s of GOURAI_TARGET_SPHERES)
  if (!GOURAI_PART_AT.has(s.part))
    GOURAI_PART_AT.set(s.part, new Vector3(s.right, s.up, -s.forward));

const v1 = new Vector3();
const v2 = new Vector3();
const local = new Vector3();
const up = new Vector3(0, 1, 0);

export class GouraiAmbient {
  /** 撃破の連鎖の次の爆発までの秒数（倒した瞬間に 0） */
  chainIn = 0;
  private readonly acc = { steam: 0, haze: 0, wash: 0, hiss: 0, cascade: 0 };

  constructor(
    private readonly spec: GouraiTierSpec,
    private readonly emit: GouraiEmit,
    private readonly motion: GouraiMotion,
    /** 体の座標の点をワールドへ */
    private readonly at: (out: Vector3, p: Readonly<Vector3>) => Vector3,
  ) {}

  /** 粒（dt > 0 のときだけ）。deadTime は倒してからの秒数、brokenSmoke は壊れた所の煙の残り秒（減らす） */
  step(
    k: GouraiKaiju,
    center: Readonly<Vector3>,
    vel: Readonly<Vector3>,
    dt: number,
    input: GouraiViewInput,
    deadTime: number,
    brokenSmoke: Map<GouraiPart, number>,
  ): void {
    const parts = k.parts;
    const A = this.acc;
    const live = !input.dead;
    const floor = k.body.floorAt(center.x, center.z);
    // 放熱の蒸気（背の放熱板の間から上へ・前の装甲の継ぎ目から前へ）
    const fin = this.motion.finOpen;
    A.steam += dt * V.steam.rate * (fin > 0.3 ? fin : 0);
    while (A.steam >= 1) {
      A.steam -= 1;
      const z = GOURAI_FIN_Z[Math.floor(Math.random() * GOURAI_FIN_Z.length)] ?? 60;
      const s = Math.random() < 0.5 ? -1 : 1;
      this.at(v1, local.set(s * (12 + Math.random() * 10), 30, z));
      this.emit.steamPuff(v1, v2.set((Math.random() - 0.5) * 0.7, 1, (Math.random() - 0.5) * 0.7));
      if (k.action === 'vent' && Math.random() < 0.4) {
        this.at(v1, local.set((Math.random() - 0.5) * 30, (Math.random() - 0.3) * 30, -58));
        this.emit.steamPuff(v1, v2.set(0, 0.6, 0), 0.8);
      }
    }
    // 熱が高いときの継ぎ目の蒸気（ときどき後ろの継ぎ目から短く）
    A.hiss += dt * (live && k.heat > 70 ? 3 : 0);
    while (A.hiss >= 1) {
      A.hiss -= 1;
      this.at(v1, local.set((Math.random() - 0.5) * 70, 22, 20 + Math.random() * 60));
      this.emit.steamPuff(v1, up, 0.6);
    }
    // 排気口の熱のゆらぎ（壊れると黒い煙）・推進器の熱と海面の吹きおろし
    if (this.spec.haze && live) {
      A.haze += dt * V.haze.rate;
      while (A.haze >= 1) {
        A.haze -= 1;
        for (const [p, x] of [
          ['exhaustL', -24],
          ['exhaustR', 24],
        ] as const) {
          if (parts.isBroken(parts.indexOf(p))) continue;
          this.at(v1, local.set(x, 4, 100));
          this.at(v2, local.set(x, 4, 101))
            .sub(v1)
            .normalize();
          this.emit.haze(v1, v2, 0.6 + k.body.pose.exhaust, false);
        }
        const tx = Math.random() < 0.5 ? -32 : 32;
        const tz = Math.random() < 0.5 ? -36 : 48;
        this.at(v1, local.set(tx, -36, tz));
        this.emit.haze(v1, v2.set(0, -1, 0), 0.8, true);
      }
      const h = center.y - floor;
      A.wash +=
        dt * (h < V.wash.height ? V.wash.rate * (1 - h / V.wash.height) * 2 : 0) * (1 - input.rise);
      while (A.wash >= 1) {
        A.wash -= 1;
        this.emit.wash(center, floor, 1);
      }
    }
    // 壊れた所の煙
    for (const [p, left] of brokenSmoke) {
      if (left <= 0) continue;
      brokenSmoke.set(p, left - dt);
      if (Math.random() > dt * (p.startsWith('exhaust') ? 6 : 3)) continue;
      this.at(v1, GOURAI_PART_AT.get(p) ?? local.set(0, 0, 0));
      this.emit.smokePuff(v1, v2.copy(vel).multiplyScalar(0.3), p.startsWith('exhaust') ? 20 : 14);
    }
    // 撃破: 爆発の連鎖（だんだん間が詰まる）と煙。沈む間は蒸気
    if (input.dead && !input.landed && deadTime < V.blast.chainSeconds + 3) {
      this.chainIn -= dt;
      if (this.chainIn <= 0) {
        this.chainIn = V.blast.chainEvery * (0.5 + Math.random()) * Math.max(0.4, 1 - deadTime / 6);
        this.at(
          v1,
          local.set(
            (Math.random() - 0.5) * 90,
            (Math.random() - 0.2) * 50,
            (Math.random() - 0.5) * 160,
          ),
        );
        this.emit.blast(v1, vel, 0.8 + Math.random() * 0.7, Math.min(10, this.spec.debris >> 3));
        this.motion.kick(0.6);
      }
      if (Math.random() < dt * 8) {
        this.at(v1, local.set((Math.random() - 0.5) * 60, 20, (Math.random() - 0.5) * 140));
        this.emit.smokePuff(v1, v2.copy(vel).multiplyScalar(0.2), 24);
      }
    }
    if (input.landed && input.sink < 1 && Math.random() < dt * 14) {
      v1.set(
        center.x + (Math.random() - 0.5) * 120,
        floor + 3,
        center.z + (Math.random() - 0.5) * 160,
      );
      this.emit.steamPuff(v1, up, 1.4);
    }
    // 登場: 浮かび上がる体から水が落ちる（水面の上に出た所から）
    if (input.rise > 0.01 && input.rise < 0.98) {
      A.cascade += dt * V.rise.cascade;
      while (A.cascade >= 1) {
        A.cascade -= 1;
        // 体の縁（横・前・後ろ）から
        const side = Math.random() < 0.5 ? -1 : 1;
        const along = Math.random() < 0.7;
        this.at(
          v1,
          local.set(
            along ? side * (36 + Math.random() * 10) : (Math.random() - 0.5) * 80,
            -10 + Math.random() * 36,
            along ? (Math.random() - 0.5) * 150 : side * (60 + Math.random() * 30),
          ),
        );
        if (v1.y > floor) this.emit.cascade(v1, floor);
      }
    }
  }
}
