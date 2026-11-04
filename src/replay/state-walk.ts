// ゲーム状態のオブジェクトグラフの走査（7-B。Three.js・DOM 非依存）: 決定性の確認用の状態ハッシュと、シーク用のキーフレーム
// （その場に書き戻すスナップショット）を同じ走査で作る。
// - 走査するのは自分のプロパティ（列挙できるもの）・配列・型付き配列・Map・Set。関数（リスナー・クロージャ）は見ない
// - 定義データ（src/data の定数）も辿るが、書き戻しても同じ値なので害はない
// - スナップショットは「オブジェクト → その時の値の並び」。書き戻すと、その後に作られたオブジェクトへの参照は消え、
//   その時点のオブジェクト同士の参照に戻る（プールの中身も、配列の長さも戻る）

type TypedArray =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray;

function isTypedArray(v: object): v is TypedArray {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

/** リスナーの入れ物（購読は状態ではない。書き戻すと後から登録したリスナーが消える） */
const LISTENER_KEY = /listeners$/i;

/**
 * 走査するプロパティ名: リスナーの入れ物を除く。オブジェクトリテラルの getter（レースの世界など）は値ではないので除く
 * （クラスの getter はプロトタイプにあるので Object.keys に出ない）
 */
function dataKeys(obj: object): string[] {
  const proto: unknown = Object.getPrototypeOf(obj);
  // クラスの static transientKeys（描画の合図など、判定に効かない値）も除く
  const ctor: unknown = (obj as { constructor?: unknown }).constructor;
  const transient =
    typeof ctor === 'function' ? (ctor as { transientKeys?: unknown }).transientKeys : undefined;
  const keys = Object.keys(obj).filter(
    (k) => !LISTENER_KEY.test(k) && !(Array.isArray(transient) && transient.includes(k)),
  );
  if (proto !== Object.prototype && proto !== null) return keys;
  return keys.filter((k) => {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    return d !== undefined && 'value' in d;
  });
}

/** 走査しないオブジェクト（重い静的データ・描画側の入れ物など）を外すための判定 */
export type WalkSkip = (obj: object) => boolean;

const KIND_OBJECT = 0;
const KIND_ARRAY = 1;
const KIND_TYPED = 2;
const KIND_MAP = 3;
const KIND_SET = 4;

interface Slot {
  readonly obj: object;
  readonly kind: number;
  readonly keys: readonly string[] | null;
  readonly values: unknown[] | TypedArray;
}

/** 走査の本体。visit はオブジェクトを初めて見たときに 1 回呼ぶ */
function walk(
  roots: readonly object[],
  skip: WalkSkip | undefined,
  onObject: (obj: object, kind: number, keys: readonly string[] | null) => void,
  onValue: (v: unknown, seen: Map<object, number>) => void,
): number {
  const seen = new Map<object, number>();
  const stack: object[] = [];
  const push = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (seen.has(v) || (skip && skip(v))) return;
    // 関数の配列（名前が listeners でないリスナーの入れ物）も状態ではない
    if (Array.isArray(v) && typeof v[0] === 'function') return;
    seen.set(v, seen.size);
    stack.push(v);
  };
  for (const r of roots) push(r);
  // 深さ優先だが順番は決定的（キーの挿入順・配列の順）
  while (stack.length > 0) {
    const obj = stack.pop();
    if (!obj) break;
    if (Array.isArray(obj)) {
      onObject(obj, KIND_ARRAY, null);
      for (const v of obj as unknown[]) {
        onValue(v, seen);
        push(v);
      }
    } else if (isTypedArray(obj)) {
      onObject(obj, KIND_TYPED, null);
    } else if (obj instanceof Map) {
      onObject(obj, KIND_MAP, null);
      for (const [k, v] of obj as Map<unknown, unknown>) {
        onValue(k, seen);
        onValue(v, seen);
        push(k);
        push(v);
      }
    } else if (obj instanceof Set) {
      onObject(obj, KIND_SET, null);
      for (const v of obj as Set<unknown>) {
        onValue(v, seen);
        push(v);
      }
    } else {
      const keys = dataKeys(obj);
      onObject(obj, KIND_OBJECT, keys);
      const rec = obj as Record<string, unknown>;
      for (const k of keys) {
        const v = rec[k];
        if (typeof v === 'function') continue;
        onValue(v, seen);
        push(v);
      }
    }
  }
  return seen.size;
}

// ---- ハッシュ ----

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const f32 = new Float32Array(1);
const u32f = new Uint32Array(f32.buffer);

/** 丸めたハッシュ（9-4）で 0 とみなす大きさ */
const ROUND_ZERO = 1e-6;
/** 丸めたハッシュ（9-4）で落とす単精度の仮数の下位ビット（23 のうち 11。残り 12 ビット ≒ 相対 2.4e-4） */
const ROUND_DROP_BITS = 11;

/**
 * 端末をまたいでも同じになるよう丸めた数のビット列（9-4）。Math.exp などの最後の桁（1 ulp）のずれでは変わらない:
 * 小さい値は 0、ほかは単精度にして仮数の下位を四捨五入で落とす（どちらも IEEE 754 で決まった計算なので、どの端末でも同じ）
 */
export function roundedBits(v: number): number {
  if (!Number.isFinite(v)) return v !== v ? 0x7fc00000 : v > 0 ? 0x7f800000 : 0xff800000;
  if (Math.abs(v) < ROUND_ZERO) return 0;
  f32[0] = v;
  const bits = u32f[0] ?? 0;
  const half = 1 << (ROUND_DROP_BITS - 1);
  return ((bits + half) & ~((1 << ROUND_DROP_BITS) - 1)) >>> 0;
}

/** 状態ハッシュ（FNV-1a 風の 32 bit を 2 本）。同じ状態なら同じ値。数値はビット列で比べる（-0 と 0 も区別） */
export class StateHasher {
  private a = 0x811c9dc5;
  private b = 0x01000193;

  /** round: 数を丸めて見る（9-4。端末をまたいだ比べ方） */
  constructor(private readonly round = false) {}

  reset(): void {
    this.a = 0x811c9dc5;
    this.b = 0x01000193;
  }

  int(v: number): void {
    this.a = Math.imul(this.a ^ (v | 0), 0x01000193) >>> 0;
    this.b = Math.imul(this.b ^ ((v >>> 16) | (v << 16)), 0x5bd1e995) >>> 0;
  }

  num(v: number): void {
    if (this.round) {
      this.int(roundedBits(v));
      return;
    }
    f64[0] = v;
    this.int(u32[0] ?? 0);
    this.int(u32[1] ?? 0);
  }

  str(s: string): void {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
  }

  get value(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }

  /** 短い値（8 桁の 16 進。記録に毎秒残す丸めたハッシュ） */
  get short(): string {
    return (this.a ^ this.b).toString(16).padStart(8, '0');
  }
}

/** roots から辿れる状態全体のハッシュ（16 桁の 16 進） */
export function hashState(roots: readonly object[], skip?: WalkSkip): string {
  return hashWith(new StateHasher(), roots, skip).value;
}

/**
 * 数を丸めた状態のハッシュ（9-4。8 桁の 16 進）: 端末の違い（数学関数の最後の桁）では変わらず、結果が分かれるほどの
 * ずれ（相対 1e-4 くらいから）で変わる。記録の始めと 1 秒ごとに残し、再生で「ここからずれた」を知らせる
 */
export function hashStateRounded(roots: readonly object[], skip?: WalkSkip): string {
  return hashWith(new StateHasher(true), roots, skip).short;
}

function hashWith(h: StateHasher, roots: readonly object[], skip?: WalkSkip): StateHasher {
  walk(
    roots,
    skip,
    (obj, kind, keys) => {
      h.int(kind);
      // キーの名前は見ない（同じ順に並ぶ値で十分。速さのため）
      if (keys) h.int(keys.length);
      else if (isTypedArray(obj)) {
        h.int(obj.length);
        for (let i = 0; i < obj.length; i++) h.num(obj[i] ?? 0);
      }
    },
    (v, seen) => {
      switch (typeof v) {
        case 'number':
          h.int(1);
          h.num(v);
          break;
        case 'boolean':
          h.int(v ? 2 : 3);
          break;
        case 'string':
          h.int(4);
          h.str(v);
          break;
        case 'undefined':
          h.int(5);
          break;
        case 'object':
          // 参照はオブジェクトを最初に見た順番で表す（グラフの形もハッシュに入る）
          h.int(v === null ? 6 : 7);
          if (v !== null) h.int(seen.get(v) ?? -1);
          break;
        default:
          h.int(8);
      }
    },
  );
  return h;
}

// ---- スナップショット ----

/** その場に書き戻せる状態の写し（シークのキーフレーム） */
export class StateSnapshot {
  private constructor(
    private readonly slots: readonly Slot[],
    /** 概算のメモリ（値の数） */
    readonly size: number,
  ) {}

  private index: Map<object, Slot> | null = null;

  /**
   * 状態を写す。base を渡すと、base と同じ値のオブジェクトは省く（差分。書き戻すときは base を先に書き戻す）
   */
  static take(roots: readonly object[], skip?: WalkSkip, base?: StateSnapshot): StateSnapshot {
    const slots: Slot[] = [];
    let size = 0;
    const index = base ? base.slotIndex() : null;
    walk(
      roots,
      skip,
      (obj, kind, keys) => {
        let values: unknown[] | TypedArray;
        if (kind === KIND_ARRAY) values = (obj as unknown[]).slice();
        else if (kind === KIND_TYPED) values = (obj as TypedArray).slice();
        else if (kind === KIND_MAP) values = [...(obj as Map<unknown, unknown>)];
        else if (kind === KIND_SET) values = [...(obj as Set<unknown>)];
        else {
          const rec = obj as Record<string, unknown>;
          values = (keys ?? []).map((k) => rec[k]);
        }
        if (index && sameSlot(index.get(obj), keys, values)) return;
        size += values.length + 2;
        slots.push({ obj, kind, keys, values });
      },
      () => undefined,
    );
    return new StateSnapshot(slots, size);
  }

  private slotIndex(): Map<object, Slot> {
    if (!this.index) {
      this.index = new Map();
      for (const s of this.slots) this.index.set(s.obj, s);
    }
    return this.index;
  }

  /** 撮った時の値をそれぞれのオブジェクトに書き戻す */
  restore(): void {
    for (const s of this.slots) {
      switch (s.kind) {
        case KIND_ARRAY: {
          const a = s.obj as unknown[];
          const v = s.values as unknown[];
          a.length = v.length;
          for (let i = 0; i < v.length; i++) a[i] = v[i];
          break;
        }
        case KIND_TYPED:
          (s.obj as TypedArray).set(s.values as never);
          break;
        case KIND_MAP: {
          const m = s.obj as Map<unknown, unknown>;
          m.clear();
          for (const e of s.values as [unknown, unknown][]) m.set(e[0], e[1]);
          break;
        }
        case KIND_SET: {
          const set = s.obj as Set<unknown>;
          set.clear();
          for (const e of s.values as unknown[]) set.add(e);
          break;
        }
        default: {
          const rec = s.obj as Record<string, unknown>;
          const keys = s.keys ?? [];
          const v = s.values as unknown[];
          // 後から足されたプロパティは消す（省略可能なプロパティ）
          const now = dataKeys(rec);
          if (now.length !== keys.length)
            for (const k of now) if (!keys.includes(k)) Reflect.deleteProperty(rec, k);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k === undefined || typeof rec[k] === 'function') continue;
            rec[k] = v[i];
          }
        }
      }
    }
  }
}

function sameSlot(
  base: Slot | undefined,
  keys: readonly string[] | null,
  values: unknown[] | TypedArray,
): boolean {
  if (!base || base.values.length !== values.length) return false;
  if (keys) {
    const bk = base.keys;
    if (!bk || bk.length !== keys.length) return false;
    for (let i = 0; i < keys.length; i++) if (bk[i] !== keys[i]) return false;
  }
  const bv = base.values;
  for (let i = 0; i < values.length; i++) if (!Object.is(bv[i], values[i])) return false;
  return true;
}
