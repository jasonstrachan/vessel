import { encodeJsonArchive, decodeJsonArchive, createJsonByteCounter } from '@/utils/jsonArchive';

describe('JSON archive', () => {
  it('round-trips repeated independent snapshots without repeating palette data', async () => {
    const palette = { stops: Array.from({ length: 256 }, (_, i) => ({ position: i / 255, color: `rgb(${i},0,0)` })) };
    const source = { events: Array.from({ length: 100 }, (_, i) => ({ i, palette: structuredClone(palette) })), unresolve: { anchor: 'retained' } };
    const archive = encodeJsonArchive(source);
    const restored = await decodeJsonArchive(archive.descriptor, async path => archive.entries.find(e => e.path === path)!.bytes);
    expect(restored).toEqual(source);
    expect(archive.entries.reduce((sum, e) => sum + e.bytes.length, 0)).toBeLessThan(JSON.stringify(source).length / 10);
    expect(source.events[0].palette).not.toBe(source.events[1].palette);
  });

  it('chunks large recording values and preserves JSON semantics and prototype-named keys', async () => {
    const source = JSON.parse('{"__proto__":{"retained":true},"unicode":"🖌️","optional":null}');
    source.large = Array.from({ length: 8 }, (_, i) => `${i}${'x'.repeat(300_000)}`);
    source.omitted = undefined;
    const archive = encodeJsonArchive(source);
    expect(archive.entries.length).toBeGreaterThan(1);
    const restored = await decodeJsonArchive(archive.descriptor, async path => archive.entries.find(e => e.path === path)!.bytes);
    expect(restored).toEqual(JSON.parse(JSON.stringify(source)));
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
  });

  it('rejects circular input and invalid archive references', async () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => encodeJsonArchive(cycle)).toThrow('cycle');
    await expect(decodeJsonArchive({ version: 1, root: 0, entries: ['buffers/extensions/0.jsonl'] },
      async () => new TextEncoder().encode('["a",[0]]\n'))).rejects.toThrow('reference');
  });

  it('counts all expanded snapshots without allocating their combined string', () => {
    const count = createJsonByteCounter();
    const event = { palette: 'p'.repeat(1024 * 1024) };
    const source = { events: Array(600).fill(event), buffers: {} };
    expect(count(source)).toBeGreaterThan(600 * 1024 * 1024);
    const small = { events: [event], unicode: '🖌️', optional: undefined, values: [undefined, null, Infinity] };
    expect(count(small)).toBe(new TextEncoder().encode(JSON.stringify(small)).length);
  });

  const chain = (depth: number, value: unknown = 'leaf'): Record<string, unknown> => {
    let result = value;
    for (let i = 0; i < depth; i += 1) result = { child: result };
    return result as Record<string, unknown>;
  };
  const readArchive = (source: Record<string, unknown>) => {
    const archive = encodeJsonArchive(source);
    return decodeJsonArchive(archive.descriptor, async path => archive.entries.find(entry => entry.path === path)!.bytes);
  };
  const encodedChain = (depth: number) => {
    const nodes = ['["v","leaf"]'];
    for (let i = 1; i <= depth; i += 1) nodes.push(JSON.stringify(['o', [['child', i - 1]]]));
    return new TextEncoder().encode(nodes.join('\n') + '\n');
  };

  it('accepts the exact depth256 boundary for writer and reader, rejecting257', async () => {
    const source = chain(256);
    await expect(readArchive(source)).resolves.toEqual(source);
    expect(() => encodeJsonArchive(chain(257))).toThrow('deeply');
    await expect(decodeJsonArchive({ version: 1, root: 256, entries: ['buffers/extensions/0.jsonl'] },
      async () => encodedChain(256))).resolves.toEqual(source);
    await expect(decodeJsonArchive({ version: 1, root: 257, entries: ['buffers/extensions/0.jsonl'] },
      async () => encodedChain(257))).rejects.toThrow('deeply');
  });

  it('rejects a deeply nested valid-reference import before returning a document', async () => {
    await expect(decodeJsonArchive({ version: 1, root: 2000, entries: ['buffers/extensions/0.jsonl'] },
      async () => encodedChain(2000))).rejects.toThrow('deeply');
  });

  it('counts cached subtree height when the same object is reused deeper', () => {
    const subtree = chain(200);
    expect(() => encodeJsonArchive({ shallow: subtree, deep: chain(56, subtree) })).toThrow('deeply');
  });

  it('retains valid repeated DAG references at the exact boundary', async () => {
    const subtree = chain(200);
    const source = { shallow: subtree, again: subtree, deep: chain(55, subtree) };
    const restored = await readArchive(source);
    expect(restored).toEqual(source);
    expect(restored.shallow).toBe(restored.again);
  });

  it.each(['1e400', '-1e400'])('rejects nonfinite imported scalar %s', async token => {
    const bytes = new TextEncoder().encode('["v",' + token + ']\n["o",[["number",0]]]\n');
    await expect(decodeJsonArchive({ version: 1, root: 1, entries: ['buffers/extensions/0.jsonl'] },
      async () => bytes)).rejects.toThrow('node');
  });

  it('retains finite extremes and realistic immutable recording data', async () => {
    const palette = { stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff', opacity: 0.5 }] };
    const source = { finite: [Number.MAX_VALUE, Number.MIN_VALUE, -Number.MAX_VALUE, 0], replay: {
      events: [{ id: 'one', scene: { width: 64, height: 48, palette } }, { id: 'two', scene: { width: 64, height: 48, palette } }],
      buffers: { a: { length: 4, chunks: [[0, 'AQI=']] } },
    }, unknown: { retained: true, unicode: '🖌️' } };
    await expect(readArchive(source)).resolves.toEqual(source);
  });
});
