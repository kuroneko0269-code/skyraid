// 塗装テクスチャ（7-3）の大きさとアトラスの行（画素）。並びの説明は src/render/aircraft-model/skin-atlas.ts

export type SkinRows = Readonly<
  Record<
    | 'fuselage'
    | 'wingRightTop'
    | 'wingRightBottom'
    | 'wingLeftBottom'
    | 'wingLeftTop'
    | 'fin'
    | 'stabTop'
    | 'stabBottom'
    | 'clean',
    readonly [number, number]
  >
>;

const rows: SkinRows = {
  fuselage: [0, 256],
  wingRightTop: [256, 448],
  wingRightBottom: [448, 512],
  wingLeftBottom: [512, 576],
  wingLeftTop: [576, 768],
  fin: [768, 960],
  stabTop: [960, 984],
  stabBottom: [984, 1008],
  clean: [1008, 1024],
};

export const SKIN_TEXTURE = { width: 512, height: 1024, rows } as const;
