async function verifyPaintingPlaybackHold(page) {
  const verifyInteraction = async (page) => {
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Color Cycle Stroke',exact:true}).click();
  await page.evaluate(() => {
    const state=window.__vesselStore.getState();
    const layer=state.layers.find(l=>l.layerType==='color-cycle');
    state.setActiveLayer(layer.id);
    state.setBrushSettings({size:24, spacing:1, pressureEnabled:false, colorCyclePencilEnabled:false,
      colorCycleBristlesEnabled:true,colorCycleBristleStrength:25,colorCycleStampDitherEnabled:true,
      colorCycleBandSpacingPx:4,colorCycleGradientSeamProfile:'hard',ccGradientRangeContrast:70,ditherPaletteSpread:0});
    const normal=state.layers.find(l=>l.layerType==='normal');
    const canvas=document.createElement('canvas');canvas.width=state.project.width;canvas.height=state.project.height;
    const ctx=canvas.getContext('2d');
    for(let y=0;y<canvas.height;y++){ctx.fillStyle=y%80<40?'#305080':'#c8a070';ctx.fillRect(0,y,canvas.width,1);}
    state.updateLayer(normal.id,{imageData:ctx.getImageData(0,0,canvas.width,canvas.height),framebuffer:canvas});
  });
  await page.getByRole('button',{name:'Unresolve',exact:true}).and(page.locator('button:not(.w-full)')).click();
  await page.getByRole('button',{name:'Effects',exact:true}).click();
  await page.getByRole('button',{name:'Unresolve',exact:true}).and(page.locator('button.w-full')).click();
  const read=()=>page.evaluate(()=>{const s=window.__vesselStore.getState();return {...s.colorCyclePlayback};});
  await page.evaluate(()=>window.__vesselStore.getState().playColorCycle('toolbar'));
  const checks=[];
  for(const ending of ['up','cancel','manual-pause']) {
    await page.mouse.move(180,180);await page.mouse.down();
    const held=await read();
    if(held.suspendDepth!==1 || !held.desiredPlaying)throw new Error('Playback not held: '+JSON.stringify(held));
    for(let i=1;i<=30;i++)await page.mouse.move(180+i*7,180+i*9);
    const during=await read();
    if(during.suspendDepth!==1)throw new Error('Hold released during painting');
    if(ending==='manual-pause')await page.evaluate(()=>window.__vesselStore.getState().pauseColorCycle('toolbar'));
    if(ending==='cancel') {
      await page.evaluate(()=>{
        const target=document.elementFromPoint(390,450);
        target.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse',clientX:390,clientY:450}));
      });
      await page.mouse.up();
    } else await page.mouse.up();
    await page.waitForFunction(()=>window.__vesselStore.getState().colorCyclePlayback.suspendDepth===0);
    const after=await read();
    if(after.desiredPlaying!==(ending!=='manual-pause'))throw new Error('Wrong playback choice after '+ending);
    checks.push({ending,heldDepth:held.suspendDepth,afterDepth:after.suspendDepth,playing:after.desiredPlaying});
  }
  await page.mouse.move(500,180);await page.mouse.down();await page.mouse.move(500,450);
  const alreadyPaused=await read();await page.mouse.up();
  await page.waitForFunction(()=>window.__vesselStore.getState().colorCyclePlayback.suspendDepth===0);
  if(alreadyPaused.suspendDepth!==1||alreadyPaused.desiredPlaying)throw new Error('Previously paused playback changed');
  return {checks,alreadyPaused:{depth:alreadyPaused.suspendDepth,playing:alreadyPaused.desiredPlaying}};
}
;
  const verifyPalettes = async (page) => {
  const getPhase = () => page.evaluate(() => {
    const s=window.__vesselStore.getState(), layer=s.layers.find(l=>l.layerType==='color-cycle');
    const a=layer.colorCycleData.colorCycleBrush.getColorCycleDerivedSurface(layer.id);
    a.forceRender();
    return Array.from(a.sampledPathPalettes.values(),p=>p.lastPhase);
  });
  await page.evaluate(()=>window.__vesselStore.getState().playColorCycle('toolbar'));
  await page.mouse.move(600,180);await page.mouse.down();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const held = await getPhase();
  if(!held.length)throw new Error('No sampled palettes to verify');
  for(let i=1;i<=15;i++)await page.mouse.move(600,180+i*10);
  const after = await getPhase();
  if(JSON.stringify(held)!==JSON.stringify(after))throw new Error('Palette playback moved while drawing: '+JSON.stringify({held:held.slice(0,5),after:after.slice(0,5),counts:[held.length,after.length]}));
  const reuse=await page.evaluate(()=>{
    const s=window.__vesselStore.getState(), layer=s.layers.find(l=>l.layerType==='color-cycle');
    const a=layer.colorCycleData.colorCycleBrush.getColorCycleDerivedSurface(layer.id);
    a.forceRender();
    const before=Array.from(a.getImageData().data);
    const signatures=a.defPaletteSignaturesById, original=signatures.set;
    let updates=0;
    signatures.set=function(id,value){if(String(value).startsWith('sampled:'))updates++;return original.call(this,id,value);};
    try {
      const start=performance.now();for(let i=0;i<20;i++)a.forceRender();
      const elapsed=performance.now()-start;
      const after=a.getImageData().data;
      if(before.some((v,i)=>v!==after[i]))throw new Error('Held redraw changed rendered pixels');
      if(updates!==0)throw new Error('Held palettes regenerated '+updates+' times');
      return {palettes:a.sampledPathPalettes.size,redraws:20,paletteUpdates:updates,elapsedMs:Math.round(elapsed)};
    } finally {signatures.set=original;}
  });
  await page.mouse.up();
  await page.waitForFunction(()=>window.__vesselStore.getState().colorCyclePlayback.suspendDepth===0);
  const resumed=await getPhase();
  await page.waitForFunction(previous=>{
    const s=window.__vesselStore.getState(),layer=s.layers.find(l=>l.layerType==='color-cycle');
    const a=layer.colorCycleData.colorCycleBrush.getColorCycleDerivedSurface(layer.id);
    return Array.from(a.sampledPathPalettes.values()).some((p,i)=>i<previous.length&&p.lastPhase!==previous[i]);
  },resumed);
  await page.evaluate(()=>window.__vesselStore.getState().pauseColorCycle('toolbar'));
  return {clockHeld:true,playbackResumed:true,reuse};
}
;
  const interaction = await verifyInteraction(page);
  const unresolve = await verifyPalettes(page);
  await page.getByRole('button',{name:'Brushes',exact:true}).click();
  await page.getByRole('button',{name:'Color Cycle Stroke',exact:true}).click();
  await page.getByRole('button',{name:'Palette',exact:true}).click();
  const ordinary = await verifyPalettes(page);
  return { interaction, unresolve, ordinary };
}
