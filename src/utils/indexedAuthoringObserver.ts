export interface IndexedAuthoringObserver {
  isEnabled?(): boolean;
  begin(layerId: string): void;
  bind(layerId: string, length: number): (index: number, written: boolean) => void;
  take(layerId: string): Uint8Array | undefined;
}

let observer: IndexedAuthoringObserver | null = null;
let writers = new WeakMap<Uint8Array, (index: number, written: boolean) => void>();

export const registerIndexedAuthoringObserver = (next: IndexedAuthoringObserver): (() => void) => {
  observer = next;
  return () => { if (observer === next) { observer = null; writers = new WeakMap(); } };
};
export const hasIndexedAuthoringObserver = (): boolean => observer !== null && (observer.isEnabled?.() ?? true);
export const beginIndexedAuthoring = (layerId: string): void => { observer?.begin(layerId); };
export const bindIndexedAuthoringBuffer = (layerId: string, buffer: Uint8Array): void => {
  if (observer) writers.set(buffer, observer.bind(layerId, buffer.length));
};
/** Called even for unchanged values: identical overlapping marks remain independent. */
export const recordIndexedAuthoringPixel = (buffer: Uint8Array, index: number, written = true): void => {
  if (observer) writers.get(buffer)?.(index, written);
};
export const takeIndexedAuthoringCoverage = (layerId: string): Uint8Array | undefined => observer?.take(layerId);
export const recordIndexedAuthoringRange = (buffer: Uint8Array, start: number, end: number): void => {
  if (!observer) return;
  const write = writers.get(buffer);
  if (write) for (let i = start; i < end; i += 1) write(i, true);
};
