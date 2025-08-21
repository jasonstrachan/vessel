import { BrushPlugin, BrushMetadata, BrushConfig } from './BrushPlugin';
import { BUILTIN_BRUSH_PLUGINS, BuiltinBrushId } from './plugins';

/**
 * Registry for managing user-created brush plugins
 * Separate from default brushes to avoid performance impact
 */
class BrushRegistry {
  private brushes: Map<string, BrushPlugin> = new Map();
  private activeBrush: BrushPlugin | null = null;
  private listeners: Set<(event: BrushRegistryEvent) => void> = new Set();

  /**
   * Register a new brush plugin
   */
  async register(brush: BrushPlugin, config?: BrushConfig): Promise<void> {
    if (this.brushes.has(brush.id)) {
      console.warn(`Brush with id "${brush.id}" is already registered, skipping registration`);
      return; // Skip instead of throwing error for hot reload compatibility
    }

    // Initialize brush if needed
    if (brush.initialize) {
      await brush.initialize(config);
    }

    this.brushes.set(brush.id, brush);
    this.emit({ type: 'registered', brushId: brush.id, metadata: brush.metadata });
  }

  /**
   * Unregister a brush plugin
   */
  unregister(brushId: string): boolean {
    const brush = this.brushes.get(brushId);
    if (!brush) return false;

    // Deactivate if it's the active brush
    if (this.activeBrush?.id === brushId) {
      this.deactivate();
    }

    // Cleanup
    if (brush.cleanup) {
      brush.cleanup();
    }

    this.brushes.delete(brushId);
    this.emit({ type: 'unregistered', brushId });
    return true;
  }

  /**
   * Get a brush by ID
   */
  get(brushId: string): BrushPlugin | undefined {
    return this.brushes.get(brushId);
  }

  /**
   * Get all registered brushes
   */
  getAll(): BrushPlugin[] {
    return Array.from(this.brushes.values());
  }

  /**
   * Get metadata for all brushes
   */
  getAllMetadata(): BrushMetadata[] {
    return this.getAll().map(brush => brush.metadata);
  }

  /**
   * Activate a brush for use
   */
  activate(brushId: string): BrushPlugin | null {
    // Deactivate current brush
    if (this.activeBrush) {
      this.deactivate();
    }

    const brush = this.brushes.get(brushId);
    if (!brush) return null;

    this.activeBrush = brush;
    if (brush.onActivate) {
      brush.onActivate();
    }

    this.emit({ type: 'activated', brushId, metadata: brush.metadata });
    return brush;
  }

  /**
   * Deactivate the current brush
   */
  deactivate(): void {
    if (!this.activeBrush) return;

    if (this.activeBrush.onDeactivate) {
      this.activeBrush.onDeactivate();
    }

    const brushId = this.activeBrush.id;
    this.activeBrush = null;
    this.emit({ type: 'deactivated', brushId });
  }

  /**
   * Get the currently active brush
   */
  getActive(): BrushPlugin | null {
    return this.activeBrush;
  }

  /**
   * Check if a brush is registered
   */
  has(brushId: string): boolean {
    return this.brushes.has(brushId);
  }

  /**
   * Check if a brush is currently active
   */
  isActive(brushId: string): boolean {
    return this.activeBrush?.id === brushId;
  }

  /**
   * Clear all brushes
   */
  clear(): void {
    // Deactivate current brush
    this.deactivate();

    // Cleanup all brushes
    for (const brush of this.brushes.values()) {
      if (brush.cleanup) {
        brush.cleanup();
      }
    }

    this.brushes.clear();
    this.emit({ type: 'cleared' });
  }

  /**
   * Subscribe to registry events
   */
  subscribe(listener: (event: BrushRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: BrushRegistryEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Load a built-in brush plugin by ID
   */
  async loadBuiltinBrush(brushId: BuiltinBrushId): Promise<BrushPlugin> {
    const loader = BUILTIN_BRUSH_PLUGINS[brushId];
    if (!loader) {
      throw new Error(`Unknown built-in brush: ${brushId}`);
    }
    
    const brush = await loader();
    await this.register(brush);
    return brush;
  }

  /**
   * Load all built-in brush plugins
   */
  async loadAllBuiltinBrushes(): Promise<void> {
    const brushIds = Object.keys(BUILTIN_BRUSH_PLUGINS) as BuiltinBrushId[];
    await Promise.all(brushIds.map(id => this.loadBuiltinBrush(id)));
  }

  /**
   * Export registry state for persistence
   */
  exportState(): BrushRegistryState {
    return {
      brushes: Array.from(this.brushes.entries()).map(([id, brush]) => ({
        id,
        metadata: brush.metadata,
      })),
      activeBrushId: this.activeBrush?.id || null,
    };
  }

  /**
   * Import registry state (doesn't include actual brush implementations)
   */
  importState(state: BrushRegistryState): void {
    // This would need to be paired with actual brush loading
    // Just sets up the metadata for now
    console.log('Registry state imported:', state);
  }
}

/**
 * Events emitted by the brush registry
 */
export type BrushRegistryEvent = 
  | { type: 'registered'; brushId: string; metadata: BrushMetadata }
  | { type: 'unregistered'; brushId: string }
  | { type: 'activated'; brushId: string; metadata: BrushMetadata }
  | { type: 'deactivated'; brushId: string }
  | { type: 'cleared' };

/**
 * Serializable state of the registry
 */
export interface BrushRegistryState {
  brushes: Array<{ id: string; metadata: BrushMetadata }>;
  activeBrushId: string | null;
}

// Singleton instance
export const brushRegistry = new BrushRegistry();

// Export for type access
export { BrushRegistry };