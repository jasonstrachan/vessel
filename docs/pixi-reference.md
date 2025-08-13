# PIXI.js v8 Documentation Reference

## Overview
PIXI.js is an advanced, open-source 2D rendering engine built on WebGL and optionally WebGPU, enabling developers to craft high-performance web graphics and interactive experiences.

## Quick Start

### Prerequisites
- Node.js v20.0 or higher
- Basic JavaScript knowledge
- Command line familiarity

### Installation

#### New Project
```bash
npm create pixi.js@latest
```

#### Add to Existing Project
```bash
npm install pixi.js
```

### Basic Setup
```javascript
import { Application, Sprite } from 'pixi.js';

async function initPixi() {
  // Create application
  const app = new Application();
  
  // Initialize with options
  await app.init({ 
    background: '#1099bb',
    resizeTo: window,
    antialias: true
  });
  
  // Add canvas to DOM
  document.body.appendChild(app.canvas);
  
  // Create and add sprite
  const sprite = Sprite.from('path/to/image.png');
  app.stage.addChild(sprite);
}

initPixi();
```

## Core Concepts

### 1. Application
The main entry point for PIXI applications. Manages the renderer, ticker, and root display object.

```javascript
const app = new Application();
await app.init({
  width: 800,
  height: 600,
  background: '#1099bb',
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true
});
```

### 2. Display Objects
Everything you see on screen inherits from DisplayObject.

#### Container
A basic display object container that can hold children.
```javascript
const container = new Container();
app.stage.addChild(container);
```

#### Sprite
A texture mapped to a rectangle.
```javascript
import { Assets, Sprite } from 'pixi.js';

// Load texture
const texture = await Assets.load('bunny.png');

// Create sprite
const bunny = new Sprite(texture);
bunny.x = app.screen.width / 2;
bunny.y = app.screen.height / 2;
bunny.anchor.set(0.5);

app.stage.addChild(bunny);
```

#### Graphics
For drawing primitive shapes.
```javascript
import { Graphics } from 'pixi.js';

const graphics = new Graphics();

// Draw a circle
graphics.beginFill(0xDE3249);
graphics.drawCircle(100, 100, 50);
graphics.endFill();

// Draw a rectangle
graphics.beginFill(0x650A5A);
graphics.drawRect(50, 250, 120, 120);
graphics.endFill();

app.stage.addChild(graphics);
```

#### Text
For rendering text.
```javascript
import { Text } from 'pixi.js';

const text = new Text('Hello PIXI!', {
  fontFamily: 'Arial',
  fontSize: 24,
  fill: 0xff1010,
  align: 'center'
});

app.stage.addChild(text);
```

### 3. Scene Graph
PIXI uses a hierarchical scene graph where display objects can have children.

```javascript
const parent = new Container();
const child1 = new Sprite(texture1);
const child2 = new Sprite(texture2);

parent.addChild(child1);
parent.addChild(child2);
app.stage.addChild(parent);

// Transforming parent affects all children
parent.x = 100;
parent.rotation = Math.PI / 4;
```

### 4. Assets
The Assets system handles loading and caching resources.

```javascript
import { Assets } from 'pixi.js';

// Load single asset
const texture = await Assets.load('bunny.png');

// Load multiple assets
const textures = await Assets.load([
  'bunny.png',
  'background.jpg',
  'spritesheet.json'
]);

// Add assets to cache
Assets.add('bunny', 'path/to/bunny.png');
await Assets.load('bunny');
```

### 5. Animation & Ticker
The ticker provides a heartbeat for animations.

```javascript
// Add a function to ticker
app.ticker.add((delta) => {
  // Rotate bunny by 0.1 radians per frame
  bunny.rotation += 0.1 * delta;
});

// Control ticker
app.ticker.stop();
app.ticker.start();
```

### 6. Interaction
PIXI supports mouse and touch events.

```javascript
sprite.eventMode = 'static'; // Enable interaction
sprite.cursor = 'pointer';

sprite.on('pointerdown', (event) => {
  console.log('Sprite clicked!');
});

sprite.on('pointerover', () => {
  sprite.tint = 0x666666;
});

sprite.on('pointerout', () => {
  sprite.tint = 0xFFFFFF;
});
```

## Key Features

### Filters & Effects
```javascript
import { BlurFilter } from 'pixi.js';

const blurFilter = new BlurFilter();
sprite.filters = [blurFilter];
```

### Masks
```javascript
const mask = new Graphics();
mask.beginFill(0xffffff);
mask.drawCircle(100, 100, 100);
mask.endFill();

sprite.mask = mask;
```

### Blend Modes
```javascript
sprite.blendMode = 'multiply'; // or 'add', 'screen', etc.
```

### Tinting
```javascript
sprite.tint = 0xFF0000; // Red tint
```

## Performance Tips

1. **Batch Rendering**: PIXI automatically batches sprites with the same texture
2. **Texture Atlases**: Use spritesheets to reduce draw calls
3. **Object Pooling**: Reuse objects instead of creating new ones
4. **Culling**: Remove off-screen objects from the scene
5. **Resolution**: Use appropriate resolution for target devices

```javascript
// Example: Object pooling
const pool = [];

function getSprite() {
  if (pool.length > 0) {
    return pool.pop();
  }
  return new Sprite(texture);
}

function returnSprite(sprite) {
  sprite.visible = false;
  pool.push(sprite);
}
```

## WebGPU Support (Experimental)
PIXI.js v8 includes experimental WebGPU support for next-generation graphics.

```javascript
import { WebGPURenderer } from 'pixi.js';

const renderer = new WebGPURenderer();
await renderer.init({
  width: 800,
  height: 600
});
```

## Common Patterns

### Responsive Canvas
```javascript
app.renderer.resize(window.innerWidth, window.innerHeight);

window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
});
```

### Loading Screen
```javascript
Assets.load(['asset1.png', 'asset2.png']).then(() => {
  // Start game
  startGame();
});

// Track loading progress
Assets.load(assets, (progress) => {
  console.log(`Loading: ${progress * 100}%`);
});
```

### Sprite Animation
```javascript
import { AnimatedSprite, Texture } from 'pixi.js';

const frames = [
  Texture.from('frame1.png'),
  Texture.from('frame2.png'),
  Texture.from('frame3.png')
];

const animatedSprite = new AnimatedSprite(frames);
animatedSprite.animationSpeed = 0.1;
animatedSprite.play();

app.stage.addChild(animatedSprite);
```

## Resources

- [Official Documentation](https://pixijs.com/8.x/guides)
- [API Reference](https://pixijs.download/dev/docs/index.html)
- [PixiJS Playground](https://pixijs.com/8.x/playground)
- [GitHub Repository](https://github.com/pixijs/pixijs)
- [Discord Community](https://discord.gg/CPTjeb28nH)

## Version Information
- Current Stable: v8.x
- WebGL Support: Full
- WebGPU Support: Experimental
- Minimum Node.js: v20.0

## Migration from v7
Key changes in v8:
- Async initialization required
- New Assets system
- Improved TypeScript support
- WebGPU renderer option
- Performance improvements

---

*Last Updated: 2024*
*Based on PIXI.js v8 Documentation*