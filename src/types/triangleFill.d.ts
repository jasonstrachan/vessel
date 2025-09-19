import './index';

declare module './index' {
  interface BrushSettings {
    triangleFillSize?: number;
    triangleFillJitter?: number;
    triangleFillRotation?: number;
  }
}
