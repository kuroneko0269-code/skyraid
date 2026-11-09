// ヴォルガスのレイドのボット（tests/kaiju-raid-bots.ts）の 1 機（運動学の簡易モデル。10-6 で kaiju-raid-bots.ts から分けた）
import type { KaijuTarget } from '../src/ai/kaiju-ai';
import { GunHeat } from '../src/combat/heat';
import { RAID_CONFIG, type KaijuPartId } from '../src/data/kaiju';
import { GUN_CONFIG } from '../src/data/weapons';

const DEG = Math.PI / 180;

export class Bot implements KaijuTarget {
  readonly position = { x: 0, y: 0, z: 0 };
  heading = 0;
  speed = 230;
  hp: number;
  active = true;
  respawn = 0;
  out = false;
  downs = 0;
  flareAge = Infinity;
  flares: number;
  missiles: number;
  stun = 0;
  readonly hitRadius = 6;
  mode: 'in' | 'out' = 'in';
  part: KaijuPartId = 'crystal';
  readonly way = { x: 0, y: 500, z: 0 };
  outTimer = 0;
  lock = 0;
  missileCooldown = 0;
  dodge = 0;
  dodgeSide = 1;
  readonly heat = new GunHeat(GUN_CONFIG.heat);
  shotTimer = 0;
  reacted = false;

  constructor(
    readonly id: number,
    readonly maxHp: number,
    readonly maxMissiles: number,
    readonly maxFlares: number,
  ) {
    this.hp = maxHp;
    this.missiles = maxMissiles;
    this.flares = maxFlares;
  }

  spawn(i: number): void {
    const s = RAID_CONFIG.start;
    this.position.x = s.x + (i - 1.5) * 150;
    this.position.y = s.y;
    this.position.z = s.z;
    this.heading = s.headingDeg * DEG;
    this.hp = this.maxHp;
    this.missiles = this.maxMissiles;
    this.flares = this.maxFlares;
    this.active = true;
    this.mode = 'in';
    this.stun = 0;
  }
}
