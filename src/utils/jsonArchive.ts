/** Lossless JSON DAG: repeated values are stored once, in bounded archive entries. */
type JsonScalar = string | number | boolean | null;
type Node = ['v', JsonScalar] | ['a', number[]] | ['o', [string, number][]];
export interface JsonArchiveDescriptor {
  version: 1;
  root: number;
  entries: string[];
}
const CHUNK_BYTES = 1024 * 1024;
const MAX_NODE_BYTES = 16 * CHUNK_BYTES;
const MAX_ARCHIVE_BYTES = 256 * CHUNK_BYTES;
const MAX_NODES = 2_000_000;
const MAX_DEPTH = 256;
const encoder = new TextEncoder();

export function encodeJsonArchive(value: Record<string, unknown>): {
  descriptor: JsonArchiveDescriptor;
  entries: { path: string; bytes: Uint8Array }[];
} {
  const identities = new WeakMap<object, number>();
  const visiting = new WeakSet<object>();
  const values = new Map<string, number>();
  const depths: number[] = [];
  const entries: { path: string; bytes: Uint8Array }[] = [];
  let lines: string[] = [], chunkBytes = 0, totalBytes = 0;
  const flush = () => {
    if (!lines.length) return;
    entries.push({ path: `buffers/extensions/${entries.length}.jsonl`, bytes: new Uint8Array(encoder.encode(lines.join(''))) });
    lines = []; chunkBytes = 0;
  };
  const visit = (input: unknown, depth: number): number => {
    if (depth > MAX_DEPTH) throw new Error('Project extension data is nested too deeply.');
    const object = typeof input === 'object' && input !== null ? input : null;
    if (object && visiting.has(object)) throw new Error('Project extension data contains a cycle.');
    const known = object ? identities.get(object) : undefined;
    if (known !== undefined) {
      if (depth + depths[known] > MAX_DEPTH) throw new Error('Project extension data is nested too deeply.');
      return known;
    }
    if (object) visiting.add(object);
    let node: Node;
    if (Array.isArray(input)) {
      node = ['a', Array.from(input, item => visit(item ?? null, depth + 1))];
    } else if (object) {
      const prototype = Object.getPrototypeOf(object);
      if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
        throw new Error('Project extension data must contain plain JSON objects.');
      }
      node = ['o', Object.entries(object).filter(([, item]) => item !== undefined)
        .map(([key, item]): [string, number] => [key, visit(item, depth + 1)])];
    } else if (input == null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number') {
      node = ['v', typeof input === 'number' && !Number.isFinite(input) ? null : input ?? null];
    } else {
      throw new Error('Project extension data contains a non-JSON value.');
    }
    const references = node[0] === 'a' ? node[1] : node[0] === 'o' ? node[1].map(([, id]) => id) : [];
    let nodeDepth = 0;
    for (const id of references) nodeDepth = Math.max(nodeDepth, depths[id] + 1);
    if (depth + nodeDepth > MAX_DEPTH) throw new Error('Project extension data is nested too deeply.');
    const json = JSON.stringify(node);
    let id = values.get(json);
    if (id === undefined) {
      id = values.size;
      const bytes = encoder.encode(json).byteLength + 1;
      totalBytes += bytes;
      if (bytes > MAX_NODE_BYTES || totalBytes > MAX_ARCHIVE_BYTES || id >= MAX_NODES) {
        throw new Error('Project extension archive exceeds its safe storage capacity.');
      }
      if (chunkBytes + bytes > CHUNK_BYTES) flush();
      lines.push(json + '\n'); chunkBytes += bytes;
      values.set(json, id);
      depths.push(nodeDepth);
    }
    if (object) { visiting.delete(object); identities.set(object, id); }
    return id;
  };
  const root = visit(value, 0);
  flush();
  return { descriptor: { version: 1, root, entries: entries.map(entry => entry.path) }, entries };
}

export async function decodeJsonArchive(
  descriptor: JsonArchiveDescriptor,
  read: (path: string) => Promise<Uint8Array>,
): Promise<Record<string, unknown>> {
  if (descriptor?.version !== 1 || !Array.isArray(descriptor.entries) || descriptor.entries.length > MAX_NODES) {
    throw new Error('Invalid project extension archive descriptor.');
  }
  const nodes: unknown[] = [];
  const depths: number[] = [];
  let totalBytes = 0;
  const ref = (id: unknown): number => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || id >= nodes.length) {
      throw new Error('Invalid project extension archive reference.');
    }
    return id;
  };
  for (let index = 0; index < descriptor.entries.length; index++) {
    const path = descriptor.entries[index];
    if (path !== `buffers/extensions/${index}.jsonl`) throw new Error('Invalid project extension archive path.');
    const bytes = await read(path);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_NODE_BYTES || totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Project extension archive is too large.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n')) throw new Error('Incomplete project extension archive.');
    for (const line of text.slice(0, -1).split('\n')) {
      const node: unknown = JSON.parse(line);
      if (!Array.isArray(node) || node.length !== 2 || nodes.length >= MAX_NODES) throw new Error('Invalid project extension archive node.');
      const [kind, payload] = node;
      let nodeDepth = 0;
      if (kind === 'v' && (payload === null || typeof payload === 'string' || typeof payload === 'boolean'
        || (typeof payload === 'number' && Number.isFinite(payload)))) {
        nodes.push(payload);
      } else if (kind === 'a' && Array.isArray(payload)) {
        nodes.push(payload.map(id => {
          const index = ref(id);
          nodeDepth = Math.max(nodeDepth, depths[index] + 1);
          return nodes[index];
        }));
      } else if (kind === 'o' && Array.isArray(payload)) {
        const object: Record<string, unknown> = {};
        for (const pair of payload) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || Object.hasOwn(object, pair[0])) throw new Error('Invalid project extension archive property.');
          const index = ref(pair[1]);
          nodeDepth = Math.max(nodeDepth, depths[index] + 1);
          Object.defineProperty(object, pair[0], { value: nodes[index], writable: true, enumerable: true, configurable: true });
        }
        nodes.push(object);
      } else throw new Error('Invalid project extension archive node.');
      if (nodeDepth > MAX_DEPTH) throw new Error('Project extension data is nested too deeply.');
      depths.push(nodeDepth);
    }
  }
  const root = nodes[ref(descriptor.root)];
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('Invalid project extension archive root.');
  return root as Record<string, unknown>;
}

/** Counts expanded JSON bytes without ever constructing a document-sized string. */
export function createJsonByteCounter(): (value: unknown) => number {
  const sizes = new WeakMap<object, number>();
  const visiting = new WeakSet<object>();
  const count = (value: unknown): number => {
    if (value === undefined) return 0;
    if (value === null || typeof value !== 'object') return encoder.encode(JSON.stringify(value) ?? 'null').byteLength;
    const cached = sizes.get(value);
    if (cached !== undefined) return cached;
    if (visiting.has(value)) throw new Error('Recording contains a cycle.');
    visiting.add(value);
    const entries = Array.isArray(value) ? Array.from(value, item => count(item ?? null))
      : Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => count(key) + 1 + count(item));
    const size = 2 + Math.max(0, entries.length - 1) + entries.reduce((a, b) => a + b, 0);
    visiting.delete(value); sizes.set(value, size);
    return size;
  };
  return count;
}
