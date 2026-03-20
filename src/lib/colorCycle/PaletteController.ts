import { GradientPalette, GradientStop } from '@/lib/GradientPalette';
import { ensurePalette, PaletteHandle } from '@/lib/colorCycle/paletteService';
import {
  appendGradientSeamProfileSignature,
  DEFAULT_GRADIENT_SEAM_PROFILE,
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';

export type PaletteRGBA = Uint8ClampedArray | Uint8Array;

export class PaletteController {
  private gradientPalette: GradientPalette;
  private gradientSignature: string | null;
  private paletteHandle: PaletteHandle | null = null;
  private paletteSignaturesBySlot: Array<string | null>;
  private palettesBySlot: Uint32Array[];
  private paletteRGBABySlot: Array<PaletteRGBA | null>;
  private seamProfilesBySlot: GradientSeamProfile[];
  private activeGradientSlot: number = 0;

  constructor(options: { gradientStops?: GradientStop[] } = {}) {
    this.gradientPalette = options.gradientStops
      ? new GradientPalette(options.gradientStops)
      : GradientPalette.createDefault();
    this.gradientSignature = options.gradientStops
      ? PaletteController.computeSignature(options.gradientStops)
      : 'preset:bw-stripes';
    this.paletteSignaturesBySlot = new Array(256).fill(null);
    this.palettesBySlot = Array.from({ length: 256 }, () => new Uint32Array(256));
    this.paletteRGBABySlot = new Array(256).fill(null);
    this.seamProfilesBySlot = new Array(256).fill(DEFAULT_GRADIENT_SEAM_PROFILE);
    this.refreshBasePalette();
  }

  getGradientPalette(): GradientPalette {
    return this.gradientPalette;
  }

  getGradientSignature(): string | null {
    return this.gradientSignature;
  }

  getPaletteStrings(): string[] {
    return this.gradientPalette.getPaletteStrings();
  }

  getPaletteHandle(): PaletteHandle {
    if (!this.paletteHandle) {
      this.paletteHandle = ensurePalette({ palette: this.gradientPalette });
    }
    return this.paletteHandle;
  }

  getActiveSlot(): number {
    return this.activeGradientSlot;
  }

  setActiveSlot(slot: number): boolean {
    const clamped = Math.max(0, Math.min(255, Math.round(slot)));
    if (this.activeGradientSlot === clamped) {
      return false;
    }
    this.activeGradientSlot = clamped;
    return true;
  }

  getPaletteSignaturesBySlot(): Array<string | null> {
    return this.paletteSignaturesBySlot;
  }

  getPaletteRGBABySlot(): Array<PaletteRGBA | null> {
    return this.paletteRGBABySlot;
  }

  getPalettesBySlot(): Uint32Array[] {
    return this.palettesBySlot;
  }

  getPaletteForSlot(slot: number): Uint32Array {
    const clamped = Math.max(0, Math.min(255, Math.round(slot)));
    return this.palettesBySlot[clamped] ?? this.getPaletteHandle().uint32;
  }

  getPaletteRGBAForSlot(slot: number): PaletteRGBA | null {
    const clamped = Math.max(0, Math.min(255, Math.round(slot)));
    return this.paletteRGBABySlot[clamped];
  }

  getSignatureForSlot(slot: number): string | null {
    const clamped = Math.max(0, Math.min(255, Math.round(slot)));
    return this.paletteSignaturesBySlot[clamped];
  }

  setGradientStops(
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = DEFAULT_GRADIENT_SEAM_PROFILE,
  ): { changed: boolean; signature: string } {
    return this.setGradientSlot(0, stops, seamProfile);
  }

  setGradientSlot(
    slot: number,
    stops: GradientStop[],
    seamProfile: GradientSeamProfile = DEFAULT_GRADIENT_SEAM_PROFILE,
  ): { changed: boolean; signature: string } {
    const clampedSlot = Math.max(0, Math.min(255, Math.round(slot)));
    const normalizedSeamProfile = normalizeGradientSeamProfile(seamProfile);
    const signature = appendGradientSeamProfileSignature(
      PaletteController.computeSignature(stops),
      normalizedSeamProfile,
    );
    if (this.paletteSignaturesBySlot[clampedSlot] === signature) {
      return { changed: false, signature };
    }
    this.paletteSignaturesBySlot[clampedSlot] = signature;
    this.seamProfilesBySlot[clampedSlot] = normalizedSeamProfile;

    if (clampedSlot === 0) {
      this.gradientSignature = signature;
      this.gradientPalette.updateFromGradient(stops, normalizedSeamProfile);
      this.refreshBasePalette();
      return { changed: true, signature };
    }

    const handle = ensurePalette({ stops, seamProfile: normalizedSeamProfile });
    this.palettesBySlot[clampedSlot] = handle.uint32;
    this.paletteRGBABySlot[clampedSlot] = handle.rgba;
    return { changed: true, signature };
  }

  setPresetPalette(palette: GradientPalette, signature: string): boolean {
    if (this.gradientSignature === signature) {
      return false;
    }
    this.gradientPalette = palette;
    this.gradientSignature = signature;
    this.refreshBasePalette();
    return true;
  }

  private refreshBasePalette() {
    this.paletteHandle = ensurePalette({
      palette: this.gradientPalette,
      seamProfile: this.gradientPalette.getSeamProfile(),
    });
    const handle = this.paletteHandle;
    this.palettesBySlot[0] = handle.uint32;
    this.paletteRGBABySlot[0] = handle.rgba;
    this.paletteSignaturesBySlot[0] = this.gradientSignature ?? 'slot:0';
    this.seamProfilesBySlot[0] = this.gradientPalette.getSeamProfile();
  }

  static computeSignature(stops: GradientStop[]): string {
    if (!stops || stops.length === 0) {
      return '[]';
    }

    return stops
      .map((stop) => {
        const pos = Number.isFinite(stop.position) ? stop.position.toFixed(6) : 'NaN';
        const opacity = Number.isFinite(stop.opacity) ? Number(stop.opacity).toFixed(6) : '1.000000';
        if (typeof stop.color === 'string') {
          return `${pos}:${stop.color}:${opacity}`;
        }
        if (stop.color && typeof stop.color === 'object') {
          const { r = 0, g = 0, b = 0 } = stop.color as { r?: number; g?: number; b?: number };
          return `${pos}:${Math.round(r)}-${Math.round(g)}-${Math.round(b)}:${opacity}`;
        }
        return `${pos}:?:${opacity}`;
      })
      .join('|');
  }
}
