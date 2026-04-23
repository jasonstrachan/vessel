const {
  LOCALSTORAGE_FLAG,
  normalizeNodeOptionsWithLocalStorage,
  stripLocalStorageFlag,
} = require('../../scripts/node-options.cjs');

describe('node-options helpers', () => {
  it('strips the local storage flag and its inline value', () => {
    expect(
      stripLocalStorageFlag(`--inspect ${LOCALSTORAGE_FLAG}=/tmp/custom-store --trace-warnings`)
    ).toBe('--inspect --trace-warnings');
  });

  it('rebuilds node options with a deterministic local storage path', () => {
    expect(
      normalizeNodeOptionsWithLocalStorage({
        nodeOptions: `--inspect ${LOCALSTORAGE_FLAG}=/tmp/stale-store`,
        storagePath: '/tmp/fresh-store',
      })
    ).toBe(`--inspect ${LOCALSTORAGE_FLAG}=/tmp/fresh-store`);
  });

  it('adds a default scoped local storage path when one is not provided', () => {
    const result = normalizeNodeOptionsWithLocalStorage({
      nodeOptions: '--trace-warnings',
      scope: 'preview-build',
    });

    expect(result).toContain('--trace-warnings');
    expect(result).toContain(`${LOCALSTORAGE_FLAG}=`);
    expect(result).toContain('vessel-localstorage-preview-build');
  });
});
