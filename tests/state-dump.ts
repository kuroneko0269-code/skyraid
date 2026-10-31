// テスト用: 状態のオブジェクトグラフを「最初に見つけた道筋 → 値」の表にする（ハッシュが合わないときにどこが違うか探す）
export function dumpState(
  roots: readonly object[],
  skip: (o: object) => boolean = () => false,
): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<object, string>();
  const queue: [object, string][] = roots.map((r, i) => [r, `root${String(i)}`]);
  for (const [r, p] of queue) seen.set(r, p);
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const [obj, path] = item;
    const entries: [string, unknown][] =
      obj instanceof Map
        ? [...obj.entries()].map(([k, v], i) => [
            `{${String(i)}:${typeof k === 'object' ? 'obj' : String(k)}}`,
            v,
          ])
        : obj instanceof Set
          ? [...obj].map((v, i) => [`<${String(i)}>`, v])
          : ArrayBuffer.isView(obj)
            ? Array.from(obj as unknown as ArrayLike<number>)
                .slice(0, 64)
                .map((v, i) => [`[${String(i)}]`, v])
            : Object.keys(obj)
                .filter((k) => !/listeners$/i.test(k))
                .map((k) => [k, (obj as Record<string, unknown>)[k]]);
    for (const [k, v] of entries) {
      const p = `${path}.${k}`;
      if (typeof v === 'function') continue;
      if (v !== null && typeof v === 'object') {
        if (skip(v)) continue;
        const s = seen.get(v);
        if (s !== undefined) {
          out.set(p, `->${s}`);
          continue;
        }
        if (Array.isArray(v) && typeof v[0] === 'function') continue;
        seen.set(v, p);
        queue.push([v, p]);
      } else out.set(p, Object.is(v, -0) ? '-0' : String(v));
    }
  }
  return out;
}

export function diffDumps(a: Map<string, string>, b: Map<string, string>, max = 30): string[] {
  const out: string[] = [];
  for (const [k, v] of a) {
    if (b.get(k) !== v) out.push(`${k}: ${v} != ${String(b.get(k))}`);
    if (out.length >= max) break;
  }
  return out;
}
