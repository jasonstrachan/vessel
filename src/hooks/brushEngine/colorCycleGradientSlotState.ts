import type { GradientStop } from '@/lib/GradientPalette';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';

export class ColorCycleGradientSlotState {
  private readonly activeGradientSignatures = new Map<string, string>();
  private readonly activeGradientSignatureVersions = new Map<string, number | null>();
  private readonly slotStopsByLayer = new Map<string, Map<number, GradientStop[]>>();
  private readonly slotSignaturesByLayer = new Map<string, Map<number, string>>();
  private readonly slotSeamProfilesByLayer = new Map<string, Map<number, GradientSeamProfile>>();
  private readonly slotBuiltFromVersionsByLayer = new Map<string, Map<number, number | null>>();
  private readonly activeSlotsByLayer = new Map<string, number>();
  private readonly activeSlotVersionsByLayer = new Map<string, number | null>();

  getActiveSlot(layerId: string): number {
    return this.activeSlotsByLayer.get(layerId) ?? 0;
  }

  setActiveSlot(layerId: string, slot: number, builtFromVersion: number | null = null): void {
    this.activeSlotsByLayer.set(layerId, slot);
    this.activeSlotVersionsByLayer.set(layerId, builtFromVersion);
  }

  getActiveSlotBuiltFromVersion(layerId: string): number | null {
    return this.activeSlotVersionsByLayer.get(layerId) ?? null;
  }

  getActiveSlotsView(): ReadonlyMap<string, number> {
    return this.activeSlotsByLayer;
  }

  getActiveGradientSignature(layerId: string): string | undefined {
    return this.activeGradientSignatures.get(layerId);
  }

  setActiveGradientSignature(layerId: string, signature: string, builtFromVersion: number | null = null): void {
    this.activeGradientSignatures.set(layerId, signature);
    this.activeGradientSignatureVersions.set(layerId, builtFromVersion);
  }

  getActiveGradientSignatureBuiltFromVersion(layerId: string): number | null {
    return this.activeGradientSignatureVersions.get(layerId) ?? null;
  }

  getSlotSignature(layerId: string, slot: number): string | undefined {
    return this.slotSignaturesByLayer.get(layerId)?.get(slot);
  }

  setSlot(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    signature: string,
    seamProfile: GradientSeamProfile,
    builtFromVersion: number | null = null,
  ): void {
    this.ensureSlotStops(layerId).set(slot, stops);
    this.ensureSlotSignatures(layerId).set(slot, signature);
    this.ensureSlotSeamProfiles(layerId).set(slot, seamProfile);
    this.ensureSlotBuiltFromVersions(layerId).set(slot, builtFromVersion);
  }

  getSlotStops(layerId: string, slot: number): GradientStop[] | undefined {
    return this.slotStopsByLayer.get(layerId)?.get(slot);
  }

  getSlotSeamProfile(layerId: string, slot: number): GradientSeamProfile {
    return this.slotSeamProfilesByLayer.get(layerId)?.get(slot) ?? 'hard';
  }

  getSlotBuiltFromVersion(layerId: string, slot: number): number | null {
    return this.slotBuiltFromVersionsByLayer.get(layerId)?.get(slot) ?? null;
  }

  clear(): void {
    this.activeGradientSignatures.clear();
    this.activeGradientSignatureVersions.clear();
    this.slotStopsByLayer.clear();
    this.slotSignaturesByLayer.clear();
    this.slotSeamProfilesByLayer.clear();
    this.slotBuiltFromVersionsByLayer.clear();
    this.activeSlotsByLayer.clear();
    this.activeSlotVersionsByLayer.clear();
  }

  private ensureSlotStops(layerId: string): Map<number, GradientStop[]> {
    let slots = this.slotStopsByLayer.get(layerId);
    if (!slots) {
      slots = new Map();
      this.slotStopsByLayer.set(layerId, slots);
    }
    return slots;
  }

  private ensureSlotSignatures(layerId: string): Map<number, string> {
    let signatures = this.slotSignaturesByLayer.get(layerId);
    if (!signatures) {
      signatures = new Map();
      this.slotSignaturesByLayer.set(layerId, signatures);
    }
    return signatures;
  }

  private ensureSlotSeamProfiles(layerId: string): Map<number, GradientSeamProfile> {
    let seamProfiles = this.slotSeamProfilesByLayer.get(layerId);
    if (!seamProfiles) {
      seamProfiles = new Map();
      this.slotSeamProfilesByLayer.set(layerId, seamProfiles);
    }
    return seamProfiles;
  }

  private ensureSlotBuiltFromVersions(layerId: string): Map<number, number | null> {
    let versions = this.slotBuiltFromVersionsByLayer.get(layerId);
    if (!versions) {
      versions = new Map();
      this.slotBuiltFromVersionsByLayer.set(layerId, versions);
    }
    return versions;
  }
}
