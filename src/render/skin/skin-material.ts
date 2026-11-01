// 塗装テクスチャ（7-3）の GPU 側: 機体ごとに 1 枚の DataTexture（塗装の UV = uv1 で貼る）を持ち、塗装が変わったときだけ
// 画素を作り直して送る。金属地はマテリアルの金属度・粗さも変える（シェーダーは作り直さない）
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type MeshStandardMaterial,
} from 'three';
import type { AircraftShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG } from '../../data/aircraft-model';
import { SKIN_TEXTURE } from '../../data/skin-texture';
import { findSkinPattern } from '../../data/skins';
import { encodePaint, type Paint } from '../../progression/paint';
import { paintSkinPixels, skinPixelCount } from './skin-texture';

export class SkinTexture {
  readonly texture: DataTexture;
  private readonly data = new Uint8Array(skinPixelCount());
  private key = '';
  private shape: Readonly<AircraftShape> | null = null;

  constructor() {
    const t = new DataTexture(
      this.data,
      SKIN_TEXTURE.width,
      SKIN_TEXTURE.height,
      RGBAFormat,
      UnsignedByteType,
    );
    t.colorSpace = SRGBColorSpace;
    t.channel = 1;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 4;
    this.texture = t;
  }

  /** 形と塗装の画素を作って送る。前と同じなら何もしない。作り直したら true */
  update(shape: Readonly<AircraftShape>, paint: Readonly<Paint>): boolean {
    const key = encodePaint(paint).join(',');
    if (key === this.key && shape === this.shape) return false;
    this.key = key;
    this.shape = shape;
    paintSkinPixels(shape, paint, this.data);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** パターンの金属度・粗さ（金属地以外は 4-3 の塗装の値） */
export function applySkinSurface(material: MeshStandardMaterial, paint: Readonly<Paint>): void {
  const s = findSkinPattern(paint.pattern)?.surface ?? null;
  const p = AIRCRAFT_MODEL_CONFIG.paint;
  material.metalness = s?.metalness ?? p.metalness;
  material.roughness = s?.roughness ?? p.roughness;
}
