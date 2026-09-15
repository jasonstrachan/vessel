// Shared by the rendered CPU/GPU browser suite and the live Studio regression check.
async function verifySampledPathRendering(renderVesselWebGL) {
  const source = Uint8Array.from({ length: 512 * 4 }, (_, i) => {
    const band = Math.floor(i / 4);
    return [band % 251, Math.floor(band / 3) % 241, Math.floor(band / 7) % 239, 255][i % 4];
  });
  const rgba = btoa(Array.from(source, byte => String.fromCharCode(byte)).join(''));
  const stops = [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }];
  const metadata = {
    format: 'vessel-goblet2', version: 1,
    project: { id: 'sampled-path', name: 'Sampled path', width: 512, height: 1, backgroundColor: '#00000000' },
    colorCycle: { schemaVersion: 2 }, viewport: { mode: 'fixed', designWidth: 512, designHeight: 1 },
    settings: { displayFilters: [], includeHiddenLayers: true },
    layers: [{ id: 'sampled', name: 'Sampled', type: 'color-cycle', visible: true, opacity: 1,
      source: { width: 512, height: 1 }, documentBoundsPx: { x: 0, y: 0, width: 512, height: 1 },
      alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
      colorCycle: { mode: 'brush', speedMode: 'buffer', speedMin: 0, speedMax: 2.64, isAnimating: true,
        gradientDefStore: [0, 255, 510].map((offset, i) => ({ id: i + 1, stops, seamProfile: 'hard', sampledPath: { rgba, offset } })),
        brushState: { width: 512, height: 1, indexBuffer: Array.from({ length: 512 }, (_, i) => 1 + i % 255),
          gradientIdBuffer: Array(512).fill(0), gradientDefIdBuffer: Array.from({ length: 512 }, (_, i) => 1 + Math.floor(i / 255)),
          speedBuffer: Array(512).fill(17), flowBuffer: Array(512).fill(5), phaseBuffer: Array(512).fill(0),
          gradientStops: stops, animationOffset: 0, alphaMode: 'opaque-indices' } } }],
  };
  const gpu = document.createElement('canvas'), cpu = document.createElement('canvas');
  const original = HTMLCanvasElement.prototype.getContext;
  const viewer = canvas => Object.getOwnPropertySymbols(canvas).map(key => canvas[key]).find(value => value?.dynamicPlayers);
  let g, c;
  try {
    await renderVesselWebGL(structuredClone(metadata), gpu, {});
    g = viewer(gpu);
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type === 'webgl2' ? null : original.call(this, type, ...args);
    };
    try { await renderVesselWebGL(structuredClone(metadata), cpu, {}); }
    finally { HTMLCanvasElement.prototype.getContext = original; }
    c = viewer(cpu);
    g.stop(); c.stop();
    if (!g.dynamicPlayers[0].useWebGL || c.dynamicPlayers[0].useWebGL) throw new Error('Both renderer paths must be exercised');
    const speed = (17 - 1) / 254 * 2.64;
    for (const phase of [0, 0.25, 0.5, 1, 0]) {
      g.renderAtTime(phase / speed); c.renderAtTime(phase / speed);
      const a = gpu.getContext('2d').getImageData(0, 0, 512, 1).data;
      const b = cpu.getContext('2d').getImageData(0, 0, 512, 1).data;
      for (let i = 0; i < a.length; i++) {
        const band = (Math.floor(i / 4) - Math.round(phase * 512) + 512) % 512;
        const expected = source[band * 4 + i % 4];
        if (Math.abs(a[i] - expected) > 1 || Math.abs(b[i] - expected) > 1) {
          throw new Error('Sampled reference mismatch at phase ' + phase + ', channel ' + i + ': ' + a[i] + '/' + b[i] + ' expected ' + expected);
        }
      }
    }
    return { phases: 5, sourceBands: 512, sections: 3, referenceMatched: true };
  } finally {
    HTMLCanvasElement.prototype.getContext = original;
    g?.destroy(); c?.destroy();
  }
}
