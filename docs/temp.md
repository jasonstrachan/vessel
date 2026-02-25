```js
window.__pp=(e)=>{if(!(e.buttons&1))return;if(!(e.target instanceof HTMLCanvasElement))return;console.log('pt',e.pointerType,'p',e.pressure,'btn',e.buttons)};window.addEventListener('pointermove',window.__pp,true);window.addEventListener('pointerdown',window.__pp,true);
```
