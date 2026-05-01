# CC Layer Wipe / Autosave Diagnostics

Use this in the same Vessel browser tab where the wipe happened.

Do not reload first. Do not save first. Do not clear site data.

## 1. Full Copy Command

Paste this whole line into DevTools Console. It copies the diagnostic JSON to your clipboard.

```js
copy(JSON.stringify((()=>{const safe=(fn,fallback=null)=>{try{return fn()}catch(e){return {error:String(e)}}};const log=safe(()=>window.__VESSEL_GET_CC_MUTATION_LOG__?.()??JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'[]'),[]);const interesting=Array.isArray(log)?log.filter(e=>e?.event==='color-cycle-layer-cleared'||e?.event==='layer-update-destructive'||e?.event==='project-save-dangling-archive-ref'||e?.event==='cc-empty-live-buffer-write-blocked'||(e?.before?.hasContent===true&&e?.after?.hasContent===false)):[];return{capturedAt:new Date().toISOString(),href:location.href,helpers:{mutationHelper:typeof window.__VESSEL_GET_CC_MUTATION_LOG__,dumpHelper:typeof window.__VESSEL_DUMP_CC_DIAGNOSTICS__,activeLayerHelper:typeof window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__},logCount:Array.isArray(log)?log.length:null,interesting:interesting.map(e=>({t:e.t?new Date(e.t).toISOString():null,event:e.event,severity:e.severity,layerId:e.layerId,reason:e.reason,href:e.href,before:e.before,after:e.after,details:e.details,stack:e.stack})),last50:Array.isArray(log)?log.slice(-50).map(e=>({t:e.t?new Date(e.t).toISOString():null,event:e.event,severity:e.severity,layerId:e.layerId,reason:e.reason,beforeHasContent:e.before?.hasContent,afterHasContent:e.after?.hasContent,details:e.details,stack:e.stack})):[],active:safe(()=>window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?.()),dump:safe(()=>window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.())};})(),null,2))
```

## 2. Smaller Fallback

Use this only if the full command fails or copies nothing.

```js
copy(JSON.stringify((()=>{const log=window.__VESSEL_GET_CC_MUTATION_LOG__?.()??JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'[]');return log.filter(e=>e?.event==='color-cycle-layer-cleared'||e?.event==='layer-update-destructive'||e?.event==='project-save-dangling-archive-ref'||e?.event==='cc-empty-live-buffer-write-blocked'||(e?.before?.hasContent===true&&e?.after?.hasContent===false));})(),null,2))
```

## 3. Quick Helper Check

Use this if the copy commands return `undefined` or an empty result.

```js
({mutationHelper:typeof window.__VESSEL_GET_CC_MUTATION_LOG__,dumpHelper:typeof window.__VESSEL_DUMP_CC_DIAGNOSTICS__,activeLayerHelper:typeof window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__,href:location.href,logBytes:(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'').length})
```

## 4. Selection / Delete Trace

Use this after reproducing a suspicious selection delete. It copies the selection-bound changes, Delete/Backspace keydowns, and CC clear/block events in timestamp order.

```js
copy(JSON.stringify((()=>{const safe=(fn,fallback=null)=>{try{return fn()}catch(e){return {error:String(e)}}};const log=safe(()=>window.__VESSEL_GET_CC_MUTATION_LOG__?.()??JSON.parse(localStorage.getItem('VESSEL_CC_MUTATION_LOG')||'[]'),[]);const events=new Set(['selection-bounds-set','keyboard-delete-keydown','color-cycle-layer-cleared','color-cycle-keyboard-delete-full-content-blocked','color-cycle-selection-clear-skipped-missing-canonical-paint','layer-update-destructive']);return{capturedAt:new Date().toISOString(),href:location.href,helpers:{mutationHelper:typeof window.__VESSEL_GET_CC_MUTATION_LOG__,dumpHelper:typeof window.__VESSEL_DUMP_CC_DIAGNOSTICS__,activeLayerHelper:typeof window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__},trace:Array.isArray(log)?log.filter(e=>events.has(e?.event)||(e?.before?.hasContent===true&&e?.after?.hasContent===false)).map(e=>({t:e.t?new Date(e.t).toISOString():null,event:e.event,severity:e.severity,layerId:e.layerId,reason:e.reason,before:e.before,after:e.after,details:e.details,stack:e.stack})):[],active:safe(()=>window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?.())};})(),null,2))
```

## What Matters

- Any event where `before.hasContent` is `true` and `after.hasContent` is `false` is a wipe candidate.
- `selection-bounds-set` shows where the marquee/selection rectangle came from. Important `details.source` values include `selection-marquee-preview`, `selection-marquee-final`, `selection-handle`, `history-selection-backward`, and `history-selection-forward`.
- `keyboard-delete-keydown` shows the actual Delete/Backspace event, active tool, keyboard scope, focused target, active layer, and selection bounds at the moment the key was handled.
- `color-cycle-layer-cleared` should only happen for explicit destructive actions.
- `color-cycle-keyboard-delete-full-content-blocked` means the safety guard stopped a keyboard delete from clearing all live CC paint from a normal set-bounds selection.
- `layer-update-destructive` can reveal store-level layer replacement.
- `project-save-dangling-archive-ref` or `cc-empty-live-buffer-write-blocked` points at save/autosave serialization.
- Autosave should not be able to turn layer pixels into empty state.
