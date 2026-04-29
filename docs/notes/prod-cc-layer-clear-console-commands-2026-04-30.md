# Prod CC Layer Clear Console Commands

Use these in DevTools Console on the same production tab where the layer clear or save error happened.

Do not reload the page first. Do not clear site data first.

## 1. Check Helpers

```js
({mutationHelper:typeof window.__VESSEL_GET_CC_MUTATION_LOG__,dumpHelper:typeof window.__VESSEL_DUMP_CC_DIAGNOSTICS__,activeLayerHelper:typeof window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__,href:location.href})
```

## 2. Copy Full Diagnostic Dump

```js
copy(JSON.stringify(window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.(),null,2))
```

## 3. Show Runtime Layer-Clear Events

```js
(()=>{const log=window.__VESSEL_GET_CC_MUTATION_LOG__?.()??JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'[]');return log.filter((entry)=>entry?.event==='color-cycle-layer-cleared');})()
```

## 4. Copy Compact Runtime Clear Summary

```js
copy(JSON.stringify((()=>{const log=window.__VESSEL_GET_CC_MUTATION_LOG__?.()??JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'[]');return log.filter((entry)=>entry?.event==='color-cycle-layer-cleared').map((entry)=>({t:entry.t?new Date(entry.t).toISOString():null,layerId:entry.layerId,reason:entry.reason,href:entry.href,source:entry.details?.source,operation:entry.details?.operation,direction:entry.details?.direction,expectedDestructive:entry.details?.expectedDestructive,rect:entry.details?.rect,clampedRect:entry.details?.clampedRect,roi:entry.details?.roi,patchRoi:entry.details?.patchRoi,paintBeforeNonZero:entry.details?.paintBefore?.nonZeroCount,paintAfterNonZero:entry.details?.paintAfter?.nonZeroCount,beforeHasContent:entry.before?.hasContent,afterHasContent:entry.after?.hasContent,stack:entry.stack}));})(),null,2))
```

## 5. Active Layer Snapshot

```js
window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?.()
```

## 6. Read The Result

- `mutationHelper: "function"` means the prod bundle has the runtime-clear logger installed.
- `mutationHelper: "undefined"` means wrong or old bundle, wrong URL, or the diagnostic module did not load.
- Clear events present means an actual runtime layer clear happened. Start with `reason`, `source`, `paintBeforeNonZero`, `paintAfterNonZero`, and `stack`.
- No clear events, with helpers loaded, means the current tab did not record a covered runtime clear. Treat `Project save produced dangling archive ref ... paint.bin` as save/archive corruption unless new evidence says otherwise.

## 7. Archive Check On The Failed File

Run locally against the `.vs` file that failed to load:

```bash
unzip -l /path/to/file.vs | rg 'project.json|buffers/color-cycle'
```

```bash
unzip -p /path/to/file.vs project.json | jq '.project.layers[] | select(.layerType=="color-cycle") | {id,name,state,colorCycleData}'
```

The save/load error means `project.json` references `buffers/color-cycle/.../paint.bin`, but the archive binary manifest or zip payload does not contain that matching entry.
