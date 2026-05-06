type GobletHtmlDiagnostics = {
  log: (...args: Array<unknown>) => void;
  warn: (...args: Array<unknown>) => void;
};

const transformModuleScript = (html: string, transform: (scriptContent: string) => string): string => {
  const scriptOpen = '<script type="module">';
  const scriptStart = html.indexOf(scriptOpen);
  if (scriptStart === -1) {
    throw new Error('Goblet template missing module script tag');
  }
  const contentStart = scriptStart + scriptOpen.length;
  const scriptEnd = html.indexOf('</script>', contentStart);
  if (scriptEnd === -1) {
    throw new Error('Goblet template missing module script closing tag');
  }

  const originalContent = html.slice(contentStart, scriptEnd);
  const nextContent = transform(originalContent);
  return `${html.slice(0, contentStart)}${nextContent}${html.slice(scriptEnd)}`;
};

const encodeMetadataForInlineScript = (metadataJson: string): string => {
  return metadataJson
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E');
};

export const DEFAULT_HTML_TITLE = 'Goblet';
export const DEFAULT_HTML_BACKGROUND_COLOR = '#000000';
export const GOBLET2_FORMAT = 'vessel-goblet2' as const;
export const GOBLET2_SCHEMA_VERSION = 2;

export const sanitizeHtmlTitle = (value: unknown): string => {
  if (typeof value !== 'string') {
    return DEFAULT_HTML_TITLE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_HTML_TITLE;
  }
  return trimmed.slice(0, 120);
};

export const sanitizeHtmlBackgroundColor = (value: unknown): string => {
  if (typeof value !== 'string') {
    return DEFAULT_HTML_BACKGROUND_COLOR;
  }
  const trimmed = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return DEFAULT_HTML_BACKGROUND_COLOR;
};

const escapeHtmlEntities = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const applyHtmlTitleToTemplate = (html: string, title: string): string => {
  const escapedTitle = escapeHtmlEntities(title);
  const titlePattern = /<title>[\s\S]*?<\/title>/i;
  if (titlePattern.test(html)) {
    return html.replace(titlePattern, `<title>${escapedTitle}</title>`);
  }
  const headClose = html.indexOf('</head>');
  if (headClose !== -1) {
    return `${html.slice(0, headClose)}<title>${escapedTitle}</title>${html.slice(headClose)}`;
  }
  return `<title>${escapedTitle}</title>${html}`;
};

export const applyHtmlBackgroundColorToTemplate = (html: string, color: string): string => {
  const bodyPattern = /(body\s*\{[\s\S]*?\bbackground:\s*)[^;]+;/i;
  const withBodyBackground = bodyPattern.test(html)
    ? html.replace(bodyPattern, `$1${color};`)
    : html;
  const canvasPattern = /(canvas\s*\{[\s\S]*?\bbackground:\s*)[^;]+;/i;
  return canvasPattern.test(withBodyBackground)
    ? withBodyBackground.replace(canvasPattern, `$1${color};`)
    : withBodyBackground;
};

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\$&');

const stripModuleImportStatement = (content: string, modulePath: string): string => {
  const escaped = escapeForRegExp(modulePath);
  const pattern = new RegExp(
    `\\s*import\\s+(?:[\\w*$\\s{},]+?)\\s+from\\s+['\"']${escaped}['\"'];?\\s*`,
    'g'
  );
  return content.replace(pattern, '\n');
};

const stripAllStaticImports = (content: string): string => {
  // Remove any remaining static import statements, including multiline named imports.
  return content.replace(/\s*import\s+(?:[\w*$\s{},]+?\s+from\s+)?['\"][^'\"]+['\"];?\s*/g, '\n');
};

const stripGobletImport = (content: string, runtimeModulePath = './goblet.js'): string => {
  return stripModuleImportStatement(content, runtimeModulePath);
};

const appendZipAutoloadSnippet = (
  scriptContent: string,
  bundleFilename: string,
  metadataJson: string | null,
  diagnosticsEnabled: boolean
): string => {
  const metadataLiteral = metadataJson === null ? null : encodeMetadataForInlineScript(metadataJson);
  const diagnosticsLiteral = diagnosticsEnabled ? 'true' : 'false';
  const packagedMetadataLiteral = metadataLiteral === null
    ? 'null'
    : `JSON.parse(\`${metadataLiteral}\`)`;
  const snippet = `
      const diagnosticsDefault = ${diagnosticsLiteral};
      let enableDiagnostics = diagnosticsDefault;
      if (diagnosticsDefault) {
        try {
          if (typeof window !== 'undefined') {
            if (window.__VESSEL_GOBLET_DEBUG__ === true) {
              enableDiagnostics = true;
            } else if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
              enableDiagnostics = true;
            } else if (window.localStorage && window.localStorage.getItem('vesselGobletDebug') === 'true') {
              enableDiagnostics = true;
            }
          }
        } catch {
          // ignore resolution errors (e.g., file:// without localStorage)
        }
      }
      if (typeof window !== 'undefined') {
        window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
        window.vesselGobletSetDiagnostics = diagnosticsDefault
          ? (value) => {
              try {
                window.localStorage?.setItem('vesselGobletDebug', value ? 'true' : 'false');
              } catch {
                // ignore persistence failures in readonly contexts (e.g., file://)
              }
              enableDiagnostics = Boolean(value);
              window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
            }
          : () => {
              debugWarn('raw-console', 'Goblet diagnostics are disabled in this build.');
            };
      }
      const emitLog = enableDiagnostics
        ? (...args) => {
            debugLog('raw-console', '[Vessel Goblet]', ...args);
          }
        : () => {};
      const emitWarn = enableDiagnostics
        ? (...args) => {
            debugWarn('raw-console', '[Vessel Goblet]', ...args);
          }
        : () => {};
      const expandPackagedMetadata = (raw) => {
        if (typeof expandVesselMetadata === 'function') {
          try {
            return expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via module helper', error);
          }
        }
        if (typeof window !== 'undefined' && typeof window.expandVesselMetadata === 'function') {
          try {
            return window.expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via Goblet helper', error);
          }
        }
        return raw;
      };
      const packagedMetadataRaw = ${packagedMetadataLiteral};
      if (enableDiagnostics) {
        emitLog('Parsed metadata layers (raw):', packagedMetadataRaw ? (packagedMetadataRaw.layers || packagedMetadataRaw.l) : null);
        emitLog('Layer details (raw):', (packagedMetadataRaw ? (packagedMetadataRaw.layers || packagedMetadataRaw.l) : null)?.map((layer) => ({
          id: layer?.id ?? layer?.i,
          hasTexture: Boolean(
            layer?.assets?.texture
            ?? layer?.as?.txr
            ?? (Array.isArray(layer?.assets?.textureFrames) && layer.assets.textureFrames.length > 0)
            ?? (Array.isArray(layer?.as?.txf) && layer.as.txf.length > 0)
          ),
          visible: layer?.visible ?? layer?.vi
        })));
      }
      const packagedMetadata = packagedMetadataRaw ? expandPackagedMetadata(packagedMetadataRaw) : null;
      if (enableDiagnostics) {
        emitLog('[DEBUG] Checking parsed metadata:');
        packagedMetadata?.layers?.forEach((layer) => {
          if (layer.colorCycle?.brushState) {
            const bs = layer.colorCycle.brushState;
            emitLog('[DEBUG] Layer diagnostics', {
              id: layer.id,
              hasIndexBuffer: Boolean(bs.indexBuffer),
              indexBufferType: typeof bs.indexBuffer,
              indexBufferIsArray: Array.isArray(bs.indexBuffer),
              indexBufferLength: typeof bs.indexBuffer === 'string' ? bs.indexBuffer.length : bs.indexBuffer?.length,
              preview: Array.isArray(bs.indexBuffer)
                ? bs.indexBuffer.slice(0, 6)
                : typeof bs.indexBuffer === 'string'
                  ? bs.indexBuffer.slice(0, 48)
                  : null
            });
          }
        });
      }
      const autoBundleName = ${JSON.stringify(bundleFilename)};
      const renderPackagedMetadata = async (metadata) => {
        if (enableDiagnostics) {
          emitLog('Incoming metadata layers (pre-expand):', metadata.layers || metadata.l);
        }
        const normalizedMetadata = expandPackagedMetadata(metadata);
        if (enableDiagnostics) {
          emitLog('Expanded metadata layers:', normalizedMetadata.layers);
        }
        setStatus('Rendering packaged bundle…');
        emitLog('Loaded metadata for auto-render:', normalizedMetadata);
        emitLog('Canvas element reference:', canvas);
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error('Preview canvas element is unavailable');
        }
        const scale = computeScale(normalizedMetadata);
        if (normalizedMetadata?.viewport?.mode) {
          document.body.dataset.viewportMode = normalizedMetadata.viewport.mode;
        } else {
          delete document.body.dataset.viewportMode;
        }
        if (normalizedMetadata?.settings?.viewportPreset) {
          document.body.dataset.viewportPreset = normalizedMetadata.settings.viewportPreset;
        } else {
          delete document.body.dataset.viewportPreset;
        }
        const opts = normalizedMetadata?.viewport?.mode === 'fixed'
          ? {}
          : { scale };
        const renderResult = await renderVesselWebGL(normalizedMetadata, canvas, opts);
        summarizeMetadata(normalizedMetadata, renderResult);
        lastMetadata = normalizedMetadata;
        const rendererHandle = canvas && canvas[Symbol.for('VesselRenderer')];
        if (rendererHandle && typeof rendererHandle.setSourceMetadata === 'function') {
          rendererHandle.setSourceMetadata(normalizedMetadata);
        }
        emitLog('[DEBUG] packaged Goblet stored metadata', {
          hasMetadata: Boolean(lastMetadata),
          scale
        });
        if (enableDiagnostics) {
          emitLog('Render summary:', {
            scale,
            layerCount: normalizedMetadata.layers?.length ?? 0
          });
        }
        setStatus('Packaged bundle rendered.');
      };
      const autoLoadPackagedBundle = async () => {
        try {
          setStatus('Loading packaged bundle…');
          const response = await fetch(autoBundleName, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          const metadata = await response.json();
          await renderPackagedMetadata(metadata);
          return;
        } catch (error) {
          if (error instanceof Error) {
            emitWarn('Automatic bundle load failed', error);
          }
          if (packagedMetadata) {
            try {
              await renderPackagedMetadata(packagedMetadata);
              return;
            } catch (secondaryError) {
              emitWarn('Failed to render embedded metadata', secondaryError);
            }
          }
          setStatus('Goblet ready. Drop a bundle to preview.');
        }
      };
      void autoLoadPackagedBundle();
`;
  return `${scriptContent}${snippet}`;
};

const buildInlineAlignRuntime = (alignJs: string): string => {
  const withoutSpecificImports = stripModuleImportStatement(alignJs, './num.js');
  const withoutAliasImports = stripModuleImportStatement(withoutSpecificImports, '@/utils/num');
  const withoutImports = stripAllStaticImports(withoutAliasImports);
  const sanitized = withoutImports
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .trim();

  if (!sanitized) {
    return '';
  }

  const exports = ['normalizeAlignment', 'computeLayerTransform', 'computeLayerDestination'];
  const exportList = exports.join(', ');

  return `const { ${exportList} } = (() => {\n${sanitized}\nreturn { ${exportList} };\n})();`;
};

const buildInlineInflateRuntime = (inflateJs: string): string => {
  let sanitized = inflateJs
    .replace(/export\s+default\s+inflateRaw;?/g, '')
    .replace(/export\s+\{\s*inflateRaw\s*\};?/g, '')
    .replace(/export\s+const\s+inflateRaw\s*=/g, 'const inflateRaw =');
  sanitized = sanitized.trimEnd();
  return `const inflateRaw = (() => {\n${sanitized}\nreturn inflateRaw;\n})();`;
};

const buildInlineNumRuntime = (numJs: string): string => {
  const sanitized = numJs
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .trim();
  return sanitized ? `${sanitized}\n` : '';
};

const buildInlineDisplayFilterRuntime = (displayFilterJs: string): string => {
  const sanitized = displayFilterJs
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+[^;\n]+;?/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '')
    .trim();
  if (!sanitized) {
    return '';
  }

  const exports = [
    'getSeamlessNoisePatternSize',
    'createTileableNoiseGrid',
    'createDisplayFilterPipelineState',
    'getNextFilterWorkCanvas',
    'ensureDisplayFilterCanvas',
    'clearDisplayFilterCanvas',
    'getDisplayFilterByIdFromList',
    'hasEnabledDisplayFiltersInList',
    'applyDisplayFilterStack',
  ];
  const exportList = exports.join(', ');
  return `const { ${exportList} } = (() => {\n${sanitized}\nreturn { ${exportList} };\n})();`;
};

const buildSingleFileRenderSnippet = (metadataJson: string, diagnosticsEnabled: boolean): string => {
  const metadataLiteral = encodeMetadataForInlineScript(metadataJson);
  const diagnosticsLiteral = diagnosticsEnabled ? 'true' : 'false';
  return `
      const diagnosticsDefault = ${diagnosticsLiteral};
      const resolveDiagnostics = () => {
        if (!diagnosticsDefault) {
          return false;
        }
        try {
          if (typeof window !== 'undefined') {
            if (window.__VESSEL_GOBLET_DEBUG__ === true) {
              return true;
            }
            if (typeof window.location?.search === 'string' && window.location.search.includes('debug=1')) {
              return true;
            }
            if (window.localStorage && window.localStorage.getItem('vesselGobletDebug') === 'true') {
              return true;
            }
          }
        } catch {
          // ignore resolution errors (e.g., file:// without localStorage)
        }
        return diagnosticsDefault;
      };
      let enableDiagnostics = resolveDiagnostics();
      if (typeof window !== 'undefined') {
        window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
        window.vesselGobletSetDiagnostics = diagnosticsDefault
          ? (value) => {
              try {
                window.localStorage?.setItem('vesselGobletDebug', value ? 'true' : 'false');
              } catch {
                // ignore persistence failures in readonly contexts (e.g., file://)
              }
              enableDiagnostics = Boolean(value);
              window.__VESSEL_GOBLET_DEBUG__ = enableDiagnostics;
            }
          : () => {
              debugWarn('raw-console', 'Goblet diagnostics are disabled in this build.');
            };
      }
      const emitLog = diagnosticsDefault
        ? (...args) => {
            if (enableDiagnostics) {
              debugLog('raw-console', '[Vessel Goblet]', ...args);
            }
          }
        : () => {};
      const emitWarn = diagnosticsDefault
        ? (...args) => {
            if (enableDiagnostics) {
              debugWarn('raw-console', '[Vessel Goblet]', ...args);
            }
          }
        : () => {};
      const expandPackagedMetadata = (raw) => {
        if (typeof expandVesselMetadata === 'function') {
          try {
            return expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via module helper', error);
          }
        }
        if (typeof window !== 'undefined' && typeof window.expandVesselMetadata === 'function') {
          try {
            return window.expandVesselMetadata(raw);
          } catch (error) {
            emitWarn('Failed to expand minified metadata via Goblet helper', error);
          }
        }
        return raw;
      };
      const packagedMetadataRaw = JSON.parse(\`${metadataLiteral}\`);
      if (enableDiagnostics) {
        emitLog('Parsed metadata layers (raw):', packagedMetadataRaw.layers || packagedMetadataRaw.l);
        emitLog('Layer details (raw):', (packagedMetadataRaw.layers || packagedMetadataRaw.l)?.map((layer) => ({
          id: layer?.id ?? layer?.i,
          hasTexture: Boolean(
            layer?.assets?.texture
            ?? layer?.as?.txr
            ?? (Array.isArray(layer?.assets?.textureFrames) && layer.assets.textureFrames.length > 0)
            ?? (Array.isArray(layer?.as?.txf) && layer.as.txf.length > 0)
          ),
          visible: layer?.visible ?? layer?.vi
        })));
      }
      const packagedMetadata = expandPackagedMetadata(packagedMetadataRaw);
      if (enableDiagnostics) {
        emitLog('[DEBUG] Prepared Goblet metadata for single-file bundle', {
          layerCount: packagedMetadata.layers?.length ?? 0,
          hasFallback: Boolean(packagedMetadata.fallback)
        });
      }
      const renderPackagedBundle = async () => {
        try {
          if (enableDiagnostics) {
            emitLog('[goblet] Starting render, metadata:', packagedMetadata);
          }
          if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Preview canvas element is unavailable');
          }
          setStatus('Rendering packaged bundle…');
          if (enableDiagnostics) {
            emitLog('Expanded metadata layers (single-file):', packagedMetadata.layers);
          }
          if (Array.isArray(packagedMetadata.layers)) {
            if (enableDiagnostics) {
              emitLog('[goblet] Full layer data:', packagedMetadata.layers.map((layer) => ({
                id: layer.id,
                documentBoundsPx: layer.documentBoundsPx,
                layoutPlacement: layer.layoutPlacement,
                source: layer.source,
                contentBounds: layer.contentBounds,
                opacity: layer.opacity,
                visible: layer.visible,
                hasTexture: Boolean(layer.assets?.texture),
                textureStart: typeof layer.assets?.texture === 'string' ? layer.assets.texture.substring(0, 50) : undefined
              })));
            }
          }
          const scale = computeScale(packagedMetadata);
          if (enableDiagnostics) {
            emitLog('[goblet] Computed scale:', scale);
          }
          if (packagedMetadata?.settings?.viewportPreset) {
            document.body.dataset.viewportPreset = packagedMetadata.settings.viewportPreset;
          } else {
            delete document.body.dataset.viewportPreset;
          }
          const opts = packagedMetadata?.viewport?.mode === 'fixed'
            ? {}
            : { scale };
          const renderResult = await renderVesselWebGL(packagedMetadata, canvas, opts);
          if (enableDiagnostics) {
            emitLog('[goblet] Render complete:', renderResult);
          }
          summarizeMetadata(packagedMetadata, renderResult);
          if (enableDiagnostics) {
            emitLog('Goblet render summary:', {
              scale,
              layers: packagedMetadata.layers?.length ?? 0
            });
          }
          setStatus('Packaged bundle rendered.');
        } catch (error) {
          logError('[goblet] Render failed:', error);
          logError('[goblet] Stack trace:', error?.stack);
          emitWarn('Failed to render packaged bundle', error);
          setStatus(error instanceof Error ? error.message : 'Failed to render bundle', 'error');
        }
      };
      void renderPackagedBundle();
`;
};

const buildSingleFileScript = (
  scriptContent: string,
  gobletRuntime: string,
  runtimeModulePath: string,
  alignRuntime: string,
  displayFilterRuntime: string,
  numRuntime: string,
  inflateRuntime: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  const withoutImport = stripGobletImport(scriptContent, runtimeModulePath);
  const runtimeWithoutAlignImport = stripModuleImportStatement(gobletRuntime, './alignFitResolver.js');
  const runtimeWithoutNumImport = stripModuleImportStatement(runtimeWithoutAlignImport, './num.js');
  const runtimeWithoutInflateImport = stripModuleImportStatement(runtimeWithoutNumImport, './fflate-inflate.js');
  const runtimeWithoutDisplayFilterImport = stripModuleImportStatement(runtimeWithoutInflateImport, './displayFilterPipeline.js');
  const inlineInflateAlreadyPresent = /const\s+inflateRaw\s*=\s*\(\s*\(\s*\)\s*=>/.test(runtimeWithoutDisplayFilterImport);
  const inlineInflate = inlineInflateAlreadyPresent ? '' : buildInlineInflateRuntime(inflateRuntime);
  const inlineAlign = buildInlineAlignRuntime(alignRuntime);
  const inlineNum = buildInlineNumRuntime(numRuntime);
  const inlineDisplayFilter = buildInlineDisplayFilterRuntime(displayFilterRuntime);
  const runtimePrefixParts = [] as string[];
  if (inlineNum) {
    runtimePrefixParts.push(inlineNum);
  }
  if (inlineDisplayFilter) {
    runtimePrefixParts.push(inlineDisplayFilter);
  }
  if (inlineAlign) {
    runtimePrefixParts.push(inlineAlign);
  }
  if (inlineInflate) {
    runtimePrefixParts.push(inlineInflate);
  }
  const runtimePrefix = runtimePrefixParts.length > 0 ? `\n${runtimePrefixParts.join('\n')}\n` : '\n';
  const runtime = `${runtimePrefix}${runtimeWithoutDisplayFilterImport}\n`;
  const snippet = buildSingleFileRenderSnippet(metadataJson, diagnosticsEnabled);
  return `${runtime}${withoutImport}${snippet}`;
};

const buildSingleFileScriptFromBundledRuntime = (
  scriptContent: string,
  bundledRuntime: string,
  runtimeModulePath: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  const withoutImport = stripGobletImport(scriptContent, runtimeModulePath);
  const runtime = bundledRuntime.endsWith('\n') ? bundledRuntime : `${bundledRuntime}\n`;
  const snippet = buildSingleFileRenderSnippet(metadataJson, diagnosticsEnabled);
  return `${runtime}${withoutImport}${snippet}`;
};

export const createZipGobletHtml = (
  template: string,
  bundleFilename: string,
  metadataJson: string | null,
  diagnosticsEnabled: boolean
): string => {
  return transformModuleScript(template, (script) => appendZipAutoloadSnippet(script, bundleFilename, metadataJson, diagnosticsEnabled));
};

const stripGobletExports = (gobletJs: string): string => {
  return gobletJs.replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+\{[^}]*\};?/g, '');
};

export const createSingleFileGobletHtml = (
  template: string,
  gobletJs: string,
  runtimeModulePath: string,
  alignJs: string,
  displayFilterJs: string,
  numJs: string,
  inflateJs: string,
  metadataJson: string,
  diagnosticsEnabled: boolean,
  diagnostics: GobletHtmlDiagnostics
): string => {
  if (diagnosticsEnabled) {
    diagnostics.log('[webglExporter] Building single-file Goblet bundle', {
      templateLength: template.length,
      gobletRuntimeLength: gobletJs.length,
      inflateRuntimeLength: inflateJs.length,
      metadataLength: metadataJson.length
    });
    try {
      const metadata = JSON.parse(metadataJson) as {
        layers?: Array<{ id: string; assets?: { texture?: string; textureFrames?: string[] } }>;
        l?: Array<{ i?: string; as?: { txr?: string; txf?: string[] } }>;
      };
      const layersRaw = Array.isArray(metadata.layers)
        ? metadata.layers
        : Array.isArray(metadata.l)
          ? metadata.l.map((layer) => ({
              id: (layer as { id?: string; i?: string }).id ?? (layer as { i?: string }).i ?? 'unknown',
              assets: layer.as?.txr || layer.as?.txf
                ? {
                    ...(layer.as?.txr ? { texture: layer.as.txr } : {}),
                    ...(Array.isArray(layer.as?.txf) ? { textureFrames: layer.as.txf } : {})
                  }
                : undefined
            }))
          : [];
      diagnostics.log('[webglExporter] Metadata summary', {
        layerCount: layersRaw.length,
        textures: layersRaw
          .filter((layer) => typeof layer?.assets?.texture === 'string' || Array.isArray(layer?.assets?.textureFrames))
          .slice(0, 8)
          .map((layer) => ({
            id: layer.id,
            texturePreview: typeof layer.assets?.texture === 'string'
              ? layer.assets.texture.slice(0, 48)
              : null,
            frameCount: Array.isArray(layer.assets?.textureFrames)
              ? layer.assets.textureFrames.length
              : 0
          }))
      });
    } catch (error) {
      diagnostics.warn('[webglExporter] Failed to parse metadata JSON for diagnostics', error);
    }
  }

  const runtime = stripGobletExports(gobletJs);
  return transformModuleScript(template, (script) =>
    buildSingleFileScript(script, runtime, runtimeModulePath, alignJs, displayFilterJs, numJs, inflateJs, metadataJson, diagnosticsEnabled)
  );
};

export const createSingleFileGobletHtmlFromBundledRuntime = (
  template: string,
  bundledRuntime: string,
  runtimeModulePath: string,
  metadataJson: string,
  diagnosticsEnabled: boolean
): string => {
  return transformModuleScript(template, (script) =>
    buildSingleFileScriptFromBundledRuntime(script, bundledRuntime, runtimeModulePath, metadataJson, diagnosticsEnabled)
  );
};
