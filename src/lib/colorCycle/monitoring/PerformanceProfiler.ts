/**
 * Performance profiling and monitoring for color cycle operations
 * Provides detailed timing, memory usage, and performance recommendations
 */

export interface ProfileResult {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
  metadata: Record<string, any>;
}

export interface PerformanceReport {
  operationName: string;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  totalMemoryUsed: number;
  peakMemoryUsage: number;
  operationCount: number;
  profiles: ProfileResult[];
  recommendations: string[];
  timestamp: number;
}

export class PerformanceProfiler {
  private static instance: PerformanceProfiler;
  private activeProfiles = new Map<string, { startTime: number; memoryBefore: number; metadata: Record<string, any> }>();
  private completedProfiles: ProfileResult[] = [];
  private maxProfileHistory = 1000;

  private constructor() {}

  static getInstance(): PerformanceProfiler {
    if (!PerformanceProfiler.instance) {
      PerformanceProfiler.instance = new PerformanceProfiler();
    }
    return PerformanceProfiler.instance;
  }

  /**
   * Start profiling an operation
   */
  start(profileId: string, metadata: Record<string, any> = {}): void {
    const startTime = performance.now();
    const memoryBefore = this.getMemoryUsage();

    this.activeProfiles.set(profileId, {
      startTime,
      memoryBefore,
      metadata
    });
  }

  /**
   * End profiling an operation
   */
  end(profileId: string, additionalMetadata: Record<string, any> = {}): ProfileResult | null {
    const activeProfile = this.activeProfiles.get(profileId);
    if (!activeProfile) {
      console.warn(`No active profile found for ID: ${profileId}`);
      return null;
    }

    const endTime = performance.now();
    const memoryAfter = this.getMemoryUsage();

    const result: ProfileResult = {
      name: profileId,
      startTime: activeProfile.startTime,
      endTime,
      duration: endTime - activeProfile.startTime,
      memoryBefore: activeProfile.memoryBefore,
      memoryAfter,
      memoryDelta: memoryAfter - activeProfile.memoryBefore,
      metadata: { ...activeProfile.metadata, ...additionalMetadata }
    };

    this.activeProfiles.delete(profileId);
    this.addCompletedProfile(result);

    return result;
  }

  /**
   * Profile a function execution
   */
  async profileFunction<T>(
    name: string,
    fn: () => Promise<T> | T,
    metadata: Record<string, any> = {}
  ): Promise<{ result: T; profile: ProfileResult }> {
    const profileId = `${name}_${Date.now()}_${Math.random()}`;
    
    this.start(profileId, metadata);
    
    try {
      const result = await fn();
      const profile = this.end(profileId, { success: true });
      return { result, profile: profile! };
    } catch (error) {
      const profile = this.end(profileId, { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Generate performance report for specific operation
   */
  generateReport(operationName?: string): PerformanceReport {
    const profiles = operationName 
      ? this.completedProfiles.filter(p => p.name.includes(operationName))
      : this.completedProfiles;

    if (profiles.length === 0) {
      return {
        operationName: operationName || 'All Operations',
        totalDuration: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        totalMemoryUsed: 0,
        peakMemoryUsage: 0,
        operationCount: 0,
        profiles: [],
        recommendations: ['No performance data available'],
        timestamp: Date.now()
      };
    }

    const durations = profiles.map(p => p.duration);
    const memoryDeltas = profiles.map(p => p.memoryDelta);

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration = totalDuration / profiles.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const totalMemoryUsed = memoryDeltas.reduce((sum, m) => Math.max(0, sum + m), 0);
    const peakMemoryUsage = Math.max(...profiles.map(p => p.memoryAfter));

    const report: PerformanceReport = {
      operationName: operationName || 'All Operations',
      totalDuration,
      averageDuration,
      minDuration,
      maxDuration,
      totalMemoryUsed,
      peakMemoryUsage,
      operationCount: profiles.length,
      profiles: [...profiles], // Copy to avoid mutation
      recommendations: this.generateRecommendations(profiles),
      timestamp: Date.now()
    };

    return report;
  }

  /**
   * Get current performance statistics
   */
  getCurrentStats(): {
    activeProfiles: number;
    completedProfiles: number;
    totalMemoryUsage: number;
    recentAverageDuration: number;
  } {
    const recent10 = this.completedProfiles.slice(-10);
    const recentAverageDuration = recent10.length > 0 
      ? recent10.reduce((sum, p) => sum + p.duration, 0) / recent10.length 
      : 0;

    return {
      activeProfiles: this.activeProfiles.size,
      completedProfiles: this.completedProfiles.length,
      totalMemoryUsage: this.getMemoryUsage(),
      recentAverageDuration
    };
  }

  /**
   * Clear performance history
   */
  clear(): void {
    this.completedProfiles.length = 0;
    this.activeProfiles.clear();
  }

  /**
   * Export performance data
   */
  exportData(): {
    timestamp: number;
    activeProfiles: Array<{ id: string; startTime: number; duration: number }>;
    completedProfiles: ProfileResult[];
    summary: PerformanceReport;
  } {
    const activeProfilesArray = Array.from(this.activeProfiles.entries()).map(([id, data]) => ({
      id,
      startTime: data.startTime,
      duration: performance.now() - data.startTime
    }));

    return {
      timestamp: Date.now(),
      activeProfiles: activeProfilesArray,
      completedProfiles: [...this.completedProfiles],
      summary: this.generateReport()
    };
  }

  /**
   * Import performance data
   */
  importData(data: ReturnType<PerformanceProfiler['exportData']>): void {
    this.completedProfiles.splice(0, this.completedProfiles.length, ...data.completedProfiles);
    
    // Don't import active profiles as they're context-dependent
    this.activeProfiles.clear();
  }

  /**
   * Add completed profile to history
   */
  private addCompletedProfile(profile: ProfileResult): void {
    this.completedProfiles.push(profile);
    
    // Maintain history limit
    if (this.completedProfiles.length > this.maxProfileHistory) {
      this.completedProfiles.splice(0, this.completedProfiles.length - this.maxProfileHistory);
    }
  }

  /**
   * Get memory usage
   */
  private getMemoryUsage(): number {
    if ((performance as any).memory) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0; // Not available
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(profiles: ProfileResult[]): string[] {
    const recommendations: string[] = [];

    if (profiles.length === 0) return recommendations;

    const durations = profiles.map(p => p.duration);
    const memoryDeltas = profiles.map(p => p.memoryDelta);

    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / profiles.length;
    const maxDuration = Math.max(...durations);
    const totalMemoryGrowth = memoryDeltas.filter(m => m > 0).reduce((sum, m) => sum + m, 0);

    // Performance recommendations
    if (averageDuration > 100) {
      recommendations.push('Average operation time is high (>100ms). Consider optimization.');
    }

    if (maxDuration > 500) {
      recommendations.push('Some operations take very long (>500ms). Check for blocking operations.');
    }

    if (totalMemoryGrowth > 50 * 1024 * 1024) { // 50MB
      recommendations.push('High memory usage detected. Consider implementing memory pooling.');
    }

    // Operation-specific recommendations
    const quantizationProfiles = profiles.filter(p => p.name.includes('quantiz'));
    if (quantizationProfiles.length > 0) {
      const avgQuantizationTime = quantizationProfiles.reduce((sum, p) => sum + p.duration, 0) / quantizationProfiles.length;
      if (avgQuantizationTime > 200) {
        recommendations.push('Color quantization is slow. Consider using RGB332 mode for better performance.');
      }
    }

    const animationProfiles = profiles.filter(p => p.name.includes('animation'));
    if (animationProfiles.length > 0) {
      const avgAnimationTime = animationProfiles.reduce((sum, p) => sum + p.duration, 0) / animationProfiles.length;
      if (avgAnimationTime > 16.67) { // 60 FPS threshold
        recommendations.push('Animation frames are taking too long. Consider reducing FPS or quality.');
      }
    }

    const ditheringProfiles = profiles.filter(p => p.name.includes('dither'));
    if (ditheringProfiles.length > 0) {
      const avgDitheringTime = ditheringProfiles.reduce((sum, p) => sum + p.duration, 0) / ditheringProfiles.length;
      if (avgDitheringTime > 50) {
        recommendations.push('Dithering is expensive. Consider disabling for performance mode.');
      }
    }

    // Browser-specific recommendations
    const failedOperations = profiles.filter(p => p.metadata.success === false);
    if (failedOperations.length > profiles.length * 0.1) { // >10% failure rate
      recommendations.push('High failure rate detected. Check browser compatibility.');
    }

    // Memory leak detection
    const memoryTrend = memoryDeltas.slice(-10); // Last 10 operations
    const consistentGrowth = memoryTrend.every(delta => delta > 0);
    if (consistentGrowth && memoryTrend.length >= 5) {
      recommendations.push('Potential memory leak detected. Check for unreleased resources.');
    }

    // General recommendations
    if (recommendations.length === 0) {
      recommendations.push('Performance looks good! No optimization needed.');
    }

    return recommendations;
  }

  /**
   * Format performance report for display
   */
  static formatReport(report: PerformanceReport): string {
    const formatTime = (ms: number) => ms < 1 ? `${(ms * 1000).toFixed(1)}μs` : `${ms.toFixed(2)}ms`;
    const formatMemory = (bytes: number) => bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;

    let output = `# Performance Report: ${report.operationName}\n\n`;
    output += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n`;
    output += `**Operations:** ${report.operationCount}\n\n`;

    output += `## Timing Statistics\n`;
    output += `- **Total Duration:** ${formatTime(report.totalDuration)}\n`;
    output += `- **Average Duration:** ${formatTime(report.averageDuration)}\n`;
    output += `- **Min/Max Duration:** ${formatTime(report.minDuration)} / ${formatTime(report.maxDuration)}\n\n`;

    output += `## Memory Statistics\n`;
    output += `- **Total Memory Used:** ${formatMemory(report.totalMemoryUsed)}\n`;
    output += `- **Peak Memory Usage:** ${formatMemory(report.peakMemoryUsage)}\n\n`;

    output += `## Recommendations\n`;
    report.recommendations.forEach(rec => {
      output += `- ${rec}\n`;
    });

    output += `\n## Detailed Profiles\n`;
    if (report.profiles.length > 0) {
      output += `| Operation | Duration | Memory Δ | Status |\n`;
      output += `|-----------|----------|----------|--------|\n`;
      
      report.profiles.slice(-20).forEach(profile => { // Show last 20
        const status = profile.metadata.success === false ? '❌' : '✅';
        output += `| ${profile.name} | ${formatTime(profile.duration)} | ${formatMemory(profile.memoryDelta)} | ${status} |\n`;
      });
    }

    return output;
  }
}