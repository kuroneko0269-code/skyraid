// アフターバーナーの炎（4-3）: ノズルから後ろへ伸びる青白いコーン（外側 + 明るい芯）。根元から先端へ透明になり、
// 長さが脈動する。光を受けない発光（MeshBasicMaterial・通常の合成）。双発でも 1 つのジオメトリ（1 draw call）
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  Mesh,
  MeshBasicMaterial,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AFTERBURNER_FLAME_CONFIG } from '../../data/aircraft-model';
import { emissiveScale } from '../materials';
import type { NozzleSpot } from './fuselage';

const core = new Color();
const tip = new Color();

/** 根元（z = 0）から +Z へ長さ 1 のコーン。色・不透明度は根元 → 先端で変える */
function cone(
  radius: number,
  x: number,
  y: number,
  brightness: number,
  opacity: number,
): BufferGeometry {
  const c = AFTERBURNER_FLAME_CONFIG;
  // +Y 向きのコーンを +Z（後ろ）へ倒し、根元を z = 0 に
  const g = new ConeGeometry(radius, 1, 14, 3, true).rotateX(Math.PI / 2).translate(x, y, 0.5);
  core.set(c.coreColor);
  tip.set(c.tipColor);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getZ(i)));
    const r = core.r + (tip.r - core.r) * t;
    const gg = core.g + (tip.g - core.g) * t;
    const b = core.b + (tip.b - core.b) * t;
    colors.set([r * brightness, gg * brightness, b * brightness, opacity * (1 - t) ** 1.3], i * 4);
  }
  g.setAttribute('color', new BufferAttribute(colors, 4));
  g.deleteAttribute('uv');
  return g;
}

export class AfterburnerFlame {
  readonly mesh: Mesh;
  /** 0（消えている）〜 1（点火） */
  private level = 0;
  private time = 0;

  constructor() {
    const c = AFTERBURNER_FLAME_CONFIG;
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    material.color.setScalar(emissiveScale(c.intensity));
    this.mesh = new Mesh(undefined, material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  /** 炎の強さ（0 = 消えている 〜 1 = 点火）。陽炎（4-4）を消すのに使う */
  get intensity(): number {
    return this.level;
  }

  /** ノズルの位置に合わせて作り直す（機体を作り直したとき） */
  setNozzles(nozzles: readonly NozzleSpot[]): void {
    const c = AFTERBURNER_FLAME_CONFIG;
    const parts: BufferGeometry[] = [];
    for (const n of nozzles) {
      const r = n.radius * c.radiusRatio;
      parts.push(cone(r, n.x, n.y, 1, c.coreOpacity * 0.7));
      parts.push(cone(r * 0.55, n.x, n.y, 1.6, c.coreOpacity));
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    this.mesh.geometry.dispose();
    this.mesh.geometry = merged;
    // 根元をノズルの後端に（脈動の伸び縮みはここが中心）
    this.mesh.position.set(0, 0, nozzles[0]?.z ?? 0);
  }

  /** dt は演出の時間（ポーズ中 0） */
  update(active: boolean, dt: number): void {
    const c = AFTERBURNER_FLAME_CONFIG;
    this.time += dt;
    const target = active ? 1 : 0;
    this.level += (target - this.level) * Math.min(1, c.response * dt);
    if (!active && this.level < 0.02) this.level = 0;
    this.mesh.visible = this.level > 0;
    if (!this.mesh.visible) return;
    const [h1, h2] = c.pulseHz;
    const pulse =
      1 +
      c.pulseAmount *
        (0.6 * Math.sin(this.time * h1 * Math.PI * 2) +
          0.4 * Math.sin(this.time * h2 * Math.PI * 2));
    // 太さは変えない（双発の左右の位置まで縮んでしまう）
    this.mesh.scale.set(1, 1, Math.max(0.01, c.length * this.level * pulse));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
