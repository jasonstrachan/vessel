# CC Layer Clear Proof Console Command - 2026-05-12

Purpose: capture the live Vessel store state before making another save, so we can prove whether a color-cycle layer is already missing canonical data in memory, gets degraded during runtime warmup, or only gets written out wrong during save.

Use this after opening the suspect `.vs` file in Vessel. Run it before saving again.

## Findings From 2026-05-12

- `4-ada-lovelace-9.vs` still had all six canonical CC buffers for `CC Layer 3`: `paint.bin`, `gradient-id.bin`, `gradient-def-id.bin`, `speed.bin`, `flow.bin`, and `phase.bin`.
- `4-ada-lovelace-10.vs` wrote the same `CC Layer 3` as preview/metadata-only: `canvas-image.txt` remained, but the six canonical CC buffer files were missing.
- A later live runtime capture showed an active CC layer with complete persisted `colorCycleData.brushState`, but the live runtime brush snapshot was empty or missing for that layer. Save/export must not let that hollow runtime snapshot override persisted canonical paint.
- A fresh-file runtime capture showed a different failure mode before persistence: the CC layer had a live runtime brush and `isAnimating: true`, but only top-level gradient buffers existed. Paint, speed, flow, phase, and persisted `brushState` were absent. That means autosave/save was not the only path; playback/warmup could publish an empty animating CC brush.

## Fixes Added

- Persistence capture now rejects incomplete live-runtime CC state and retries the next canonical source, such as persisted `brushState`, before failing the layer.
- Playback/runtime warmup no longer treats gradient-only buffers or `hasContent` metadata as recoverable CC runtime authority. It now requires recoverable paint authority, such as document paint refs or target-layer brushState paint.
- Gradient-only CC payloads remain preview/repair data; they are not editable or animated runtime authority.

## Verification Added

- `src/lib/colorCycle/persistence/__tests__/captureColorCyclePersistenceSnapshot.test.ts`: covers fallback from preview-only live runtime to persisted brushState.
- `src/utils/colorCycle/__tests__/resolveColorCycleRuntimeRestore.test.ts`: covers gradient-only buffers not being recoverable runtime source, and document paint refs still being recoverable.
- Existing coverage kept passing for `tests/cc-layer-wipe-scenario-matrix.test.ts` and `src/utils/__tests__/projectIO.test.ts`.

## Browser Console Command

```js
(()=>{const w=window,s=w.__vesselStore?.getState?.();if(!s){console.error('NO __vesselStore');return;}const len=v=>v instanceof ArrayBuffer?v.byteLength:ArrayBuffer.isView(v)?v.byteLength:typeof v==='string'?`str:${v.length}`:v?typeof v:null;const snap=(bs,id)=>bs?.layers?.find?.(x=>x?.layerId===id)||null;const brushState=l=>l.colorCycleData?.colorCycleBrush?.getFullState?.()||l.colorCycleData?.colorCycleBrush?.serialize?.()||null;const layerRow=l=>{const cc=l.colorCycleData||{},st=l.state||{},bs=cc.brushState,ps=snap(bs,l.id),rs=brushState(l),rsn=snap(rs,l.id);return{name:l.name,id:l.id,order:l.order,visible:l.visible,layerType:l.layerType,repair:cc.repairStatus||null,hydration:cc.runtimeHydrationState||null,deferred:cc.deferredRuntimeRestore??null,hasCanvas:!!cc.canvas,canvasSize:cc.canvas?`${cc.canvas.width}x${cc.canvas.height}`:null,hasCanvasImageData:!!cc.canvasImageData,canvasImageDataSize:cc.canvasImageData?`${cc.canvasImageData.width}x${cc.canvasImageData.height}`:null,statePaintRef:st.paintRef||null,stateGradientIdRef:st.gradientIdRef||null,stateGradientDefIdRef:st.gradientDefIdRef||null,stateSpeedRef:st.speedRef||null,stateFlowRef:st.flowRef||null,statePhaseRef:st.phaseRef||null,topPaint:len(cc.paintBuffer),topGradientId:len(cc.gradientIdBuffer),topGradientDefId:len(cc.gradientDefIdBuffer),topSpeed:len(cc.speedBuffer),topFlow:len(cc.flowBuffer),topPhase:len(cc.phaseBuffer),brushPaint:len(ps?.strokeData?.paintBuffer),brushGradientId:len(ps?.strokeData?.gradientIdBuffer),brushGradientDefId:len(ps?.strokeData?.gradientDefIdBuffer),brushSpeed:len(ps?.strokeData?.speedBuffer),brushFlow:len(ps?.strokeData?.flowBuffer),brushPhase:len(ps?.strokeData?.phaseBuffer),runtimePaint:len(rsn?.strokeData?.paintBuffer),runtimeGradientId:len(rsn?.strokeData?.gradientIdBuffer),runtimeGradientDefId:len(rsn?.strokeData?.gradientDefIdBuffer),runtimeSpeed:len(rsn?.strokeData?.speedBuffer),runtimeFlow:len(rsn?.strokeData?.flowBuffer),runtimePhase:len(rsn?.strokeData?.phaseBuffer)}};const report={time:new Date().toISOString(),href:location.href,activeLayerId:s.activeLayerId,project:{id:s.project?.id,name:s.project?.name,width:s.project?.width,height:s.project?.height},ccLayers:s.layers.filter(l=>l.layerType==='color-cycle').map(layerRow),mutationLog:w.__VESSEL_GET_CC_MUTATION_LOG__?.()||w.__VESSEL_CC_MUTATION_LOG__||[],debugDump:w.__VESSEL_DUMP_CC_DIAGNOSTICS__?.()||null};console.table(report.ccLayers);console.log('VESSEL_CC_PROOF_REPORT',report);navigator.clipboard?.writeText(JSON.stringify(report,null,2)).then(()=>console.log('Copied VESSEL_CC_PROOF_REPORT JSON to clipboard')).catch(()=>console.log('Clipboard copy failed; expand VESSEL_CC_PROOF_REPORT above'));return report;})()
```

## Runtime Authority Compare Command

Use this while the cleared runtime state is still loaded, before opening another file. It compares the layer-attached brush, the store/manager brush, and the persisted `brushState`.

```js
(()=>{const s=window.__vesselStore?.getState?.();if(!s){console.error('NO __vesselStore');return;}const len=v=>v instanceof ArrayBuffer?v.byteLength:ArrayBuffer.isView(v)?v.byteLength:typeof v==='string'?`str:${v.length}`:v?typeof v:null;const snap=(bs,id)=>bs?.layers?.find?.(x=>x?.layerId===id)||null;const summarize=(label,b,id)=>{let raw=null,err=null;try{raw=b?.getFullState?.()??b?.serialize?.()??null}catch(e){err=String(e)}const sn=snap(raw,id),sd=sn?.strokeData||{};return{label,present:!!b,ctor:b?.constructor?.name||null,error:err,layerCount:raw?.layers?.length??null,layerIds:raw?.layers?.map?.(x=>x.layerId)?.slice(0,8)||null,paint:len(sd.paintBuffer),gid:len(sd.gradientIdBuffer),def:len(sd.gradientDefIdBuffer),speed:len(sd.speedBuffer),flow:len(sd.flowBuffer),phase:len(sd.phaseBuffer),hasContent:sd.hasContent??sn?.hasContent??null,strokeCounter:sd.strokeCounter??null};};const ccLayers=s.layers.filter(l=>l.layerType==='color-cycle');const layerRows=ccLayers.map(l=>{const id=l.id,cc=l.colorCycleData||{},st=l.state||{},pbs=snap(cc.brushState,id)?.strokeData||{};return{name:l.name,id,active:s.activeLayerId===id,hydration:cc.runtimeHydrationState??null,deferred:cc.deferredRuntimeRestore??null,isAnimating:cc.isAnimating??null,hasCanvas:!!cc.canvas,hasImageData:!!cc.canvasImageData,topPaint:len(cc.paintBuffer),topGid:len(cc.gradientIdBuffer),topDef:len(cc.gradientDefIdBuffer),topSpeed:len(cc.speedBuffer),topFlow:len(cc.flowBuffer),topPhase:len(cc.phaseBuffer),statePaintRef:st.paintRef??null,persistPaint:len(pbs.paintBuffer),persistGid:len(pbs.gradientIdBuffer),persistDef:len(pbs.gradientDefIdBuffer),persistSpeed:len(pbs.speedBuffer),persistFlow:len(pbs.flowBuffer),persistPhase:len(pbs.phaseBuffer),layerBrush:summarize('layer.colorCycleBrush',cc.colorCycleBrush,id),storeBrush:summarize('store.getLayerColorCycleBrush',s.getLayerColorCycleBrush?.(id),id)}});const log=window.__VESSEL_GET_CC_MUTATION_LOG__?.()||window.__VESSEL_CC_MUTATION_LOG__||[];const recentByCcLayer=Object.fromEntries(ccLayers.map(l=>[l.id,log.filter(e=>e.layerId===l.id).slice(-80)]));const report={time:new Date().toISOString(),href:location.href,activeLayerId:s.activeLayerId,project:{id:s.project?.id,name:s.project?.name,width:s.project?.width,height:s.project?.height},layerRows,recentByCcLayer,recentAll:log.slice(-160),debugDump:window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.()||null};console.table(layerRows.map(r=>({name:r.name,id:r.id,active:r.active,hydration:r.hydration,isAnimating:r.isAnimating,topPaint:r.topPaint,topGid:r.topGid,persistPaint:r.persistPaint,persistGid:r.persistGid,layerBrushPaint:r.layerBrush.paint,storeBrushPaint:r.storeBrush.paint,layerBrushLayers:r.layerBrush.layerCount,storeBrushLayers:r.storeBrush.layerCount})));console.log('VESSEL_CC_RUNTIME_AUTHORITY_REPORT',report);try{copy(JSON.stringify(report,null,2));console.log('Copied VESSEL_CC_RUNTIME_AUTHORITY_REPORT')}catch(e){console.log('Copy failed; expand VESSEL_CC_RUNTIME_AUTHORITY_REPORT above')}return report;})()
```

## What To Bring Back

- The `ccLayers` table.
- The expanded `VESSEL_CC_PROOF_REPORT` object.
- The expanded `VESSEL_CC_RUNTIME_AUTHORITY_REPORT` object if you ran the runtime-authority compare command.
- The `mutationLog` entries, especially any `cc-save-primary-payload-drop-blocked`, `cc-warmup-canonical-payload-drop-blocked`, selection delete, history rehydrate, or playback empty-runtime events.

## How To Read The Key Columns

- `statePaintRef`, `stateGradientIdRef`, `stateGradientDefIdRef`, `stateSpeedRef`, `stateFlowRef`, `statePhaseRef`: saved/document-state refs currently on the layer.
- `brushPaint` through `brushPhase`: persisted `colorCycleData.brushState` canonical channels.
- `runtimePaint` through `runtimePhase`: live runtime brush channels.
- `hasCanvasImageData: true` with all canonical columns empty means preview-only data, not editable/animated CC authority.
