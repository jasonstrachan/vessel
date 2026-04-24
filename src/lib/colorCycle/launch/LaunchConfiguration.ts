/**
 * Launch configuration and monitoring setup for color cycle system
 * Handles production deployment, error tracking, and health monitoring
 */

import { debugLog, debugWarn, logError } from '@/utils/debug';
import { AppIntegration } from '../integration/AppIntegration';
import { PerformanceProfiler } from '../monitoring/PerformanceProfiler';
import { BrowserCompat } from '../compatibility/BrowserCompat';
import { AppIntegrationTest } from '../__tests__/integration/AppIntegrationTest';

export interface LaunchConfig {
  // Feature flags
  enableColorCycleFeature: boolean;
  enablePerformanceMode: boolean;
  enableDebugLogging: boolean;
  enableErrorReporting: boolean;
  enableTelemetry: boolean;

  // Performance thresholds
  maxMemoryUsageMB: number;
  maxAnimationLatencyMs: number;
  maxConcurrentLayers: number;
  
  // Monitoring settings
  performanceCheckIntervalMs: number;
  errorReportingEndpoint?: string;
  telemetryEndpoint?: string;
  
  // Fallback behavior
  disableOnHighMemoryUsage: boolean;
  disableOnPoorPerformance: boolean;
  fallbackToStaticMode: boolean;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical' | 'disabled';
  issues: string[];
  metrics: {
    memoryUsageMB: number;
    avgAnimationTimeMs: number;
    activeRecolorLayers: number;
    errorRate: number;
    uptime: number;
  };
  lastCheck: number;
}

type ErrorContext = Record<string, unknown>;

export interface ErrorReport {
  id: string;
  timestamp: number;
  level: 'error' | 'warning' | 'info';
  component: string;
  message: string;
  stack?: string;
  userAgent: string;
  url: string;
  userId?: string;
  sessionId: string;
  context: ErrorContext;
}

type DiagnosticsExport = {
  config: LaunchConfig;
  health: SystemHealth;
  errors: ErrorReport[];
  performance: ReturnType<PerformanceProfiler['exportData']>;
  browser: {
    userAgent: string;
    compatibility: ReturnType<BrowserCompat['getConfig']>;
    features: {
      canvas2d: boolean;
      webgl: boolean;
      memoryAPI: boolean;
      highResTimer: boolean;
    };
  };
};

export class LaunchConfiguration {
  private static instance: LaunchConfiguration;
  private config: LaunchConfig;
  private integration: AppIntegration;
  private profiler: PerformanceProfiler;
  private browserCompat: BrowserCompat;
  private health: SystemHealth;
  private errors: ErrorReport[] = [];
  private sessionId: string;
  private startTime: number;
  private monitoringInterval?: NodeJS.Timeout;

  private constructor() {
    this.integration = AppIntegration.getInstance();
    this.profiler = PerformanceProfiler.getInstance();
    this.browserCompat = BrowserCompat.getInstance();
    this.sessionId = this.generateSessionId();
    this.startTime = Date.now();
    
    this.config = this.generateDefaultConfig();
    this.health = this.initializeHealth();
  }

  static getInstance(): LaunchConfiguration {
    if (!LaunchConfiguration.instance) {
      LaunchConfiguration.instance = new LaunchConfiguration();
    }
    return LaunchConfiguration.instance;
  }

  /**
   * Initialize the system for launch
   */
  async launch(): Promise<{ success: boolean; issues: string[] }> {
    debugLog('raw-console', '🚀 Launching Color Cycle System...');
    
    const issues: string[] = [];

    try {
      // Step 1: Run integration tests
      debugLog('raw-console', '📋 Running pre-launch integration tests...');
      const testResults = await this.runPreLaunchTests();
      
      if (testResults.testsFailed > 0) {
        const criticalErrors = testResults.issues.filter(i => i.severity === 'error');
        if (criticalErrors.length > 0) {
          issues.push(`${criticalErrors.length} critical errors found in integration tests`);
          
          // Disable feature if critical errors exist
          if (this.config.disableOnHighMemoryUsage || this.config.disableOnPoorPerformance) {
            this.config.enableColorCycleFeature = false;
            issues.push('Color cycle feature disabled due to critical errors');
          }
        }
        
        issues.push(...testResults.issues.map(i => `${i.component}: ${i.message}`));
      }

      // Step 2: Initialize core systems
      debugLog('raw-console', '⚙️ Initializing core systems...');
      await this.integration.initialize();

      // Step 3: Setup monitoring
      if (this.config.enableTelemetry || this.config.enableErrorReporting) {
        debugLog('raw-console', '📊 Setting up monitoring and error tracking...');
        this.setupMonitoring();
      }

      // Step 4: Apply performance optimizations
      debugLog('raw-console', '🎛️ Applying performance optimizations...');
      this.applyPerformanceOptimizations();

      // Step 5: Setup error handling
      this.setupErrorHandling();

      // Step 6: Final health check
      await this.updateHealthStatus();

      const success = this.health.status !== 'critical' && this.config.enableColorCycleFeature;

      if (success) {
        debugLog('raw-console', '✅ Color Cycle System launched successfully');
        
        // Log launch success
        this.reportEvent('info', 'LaunchConfiguration', 'System launched successfully', {
          config: this.config,
          health: this.health
        });
      } else {
        debugWarn('raw-console', '⚠️ Color Cycle System launched with issues');
        issues.push(`System health: ${this.health.status}`);
      }

      return { success, issues };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown launch error';
      logError('❌ Failed to launch Color Cycle System:', error);
      
      issues.push(`Launch failed: ${errorMessage}`);
      
      // Report critical launch failure
      this.reportError('error', 'LaunchConfiguration', errorMessage, error instanceof Error ? error.stack : undefined, {
        config: this.config
      });

      return { success: false, issues };
    }
  }

  /**
   * Get current system configuration
   */
  getConfig(): LaunchConfig {
    return { ...this.config };
  }

  /**
   * Update system configuration
   */
  updateConfig(updates: Partial<LaunchConfig>): void {
    this.config = { ...this.config, ...updates };
    
    debugLog('raw-console', '🔧 Configuration updated:', updates);
    
    // Apply changes immediately if system is running
    if (this.monitoringInterval) {
      this.applyConfigChanges(updates);
    }

    this.reportEvent('info', 'LaunchConfiguration', 'Configuration updated', { updates });
  }

  /**
   * Get current system health
   */
  getHealth(): SystemHealth {
    return { ...this.health };
  }

  /**
   * Get error reports
   */
  getErrors(limit = 50): ErrorReport[] {
    return this.errors.slice(-limit);
  }

  /**
   * Export system diagnostics
   */
  exportDiagnostics(): DiagnosticsExport {
    return {
      config: this.config,
      health: this.health,
      errors: this.getErrors(100),
      performance: this.profiler.exportData(),
      browser: {
        userAgent: navigator.userAgent,
        compatibility: this.browserCompat.getConfig(),
        features: {
          canvas2d: this.browserCompat.isFeatureSupported('canvas2d'),
          webgl: this.browserCompat.isFeatureSupported('webgl'),
          memoryAPI: this.browserCompat.isFeatureSupported('memory-api'),
          highResTimer: this.browserCompat.isFeatureSupported('high-res-timer')
        }
      }
    };
  }

  /**
   * Shutdown system gracefully
   */
  shutdown(): void {
    debugLog('raw-console', '🛑 Shutting down Color Cycle System...');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.reportEvent('info', 'LaunchConfiguration', 'System shutdown', {
      uptime: Date.now() - this.startTime,
      finalHealth: this.health
    });

    debugLog('raw-console', '✅ Color Cycle System shutdown complete');
  }

  /**
   * Run pre-launch integration tests
   */
  private async runPreLaunchTests() {
    const integrationTest = new AppIntegrationTest();
    return await integrationTest.runAppIntegrationTests();
  }

  /**
   * Setup system monitoring
   */
  private setupMonitoring(): void {
    if (this.monitoringInterval) return;

    this.monitoringInterval = setInterval(async () => {
      await this.updateHealthStatus();
      
      // Check for degraded performance
      if (this.health.status === 'degraded' || this.health.status === 'critical') {
        this.handleDegradedPerformance();
      }
      
      // Clean up old errors
      if (this.errors.length > 1000) {
        this.errors = this.errors.slice(-500);
      }
      
    }, this.config.performanceCheckIntervalMs);

    debugLog('raw-console', `📊 Monitoring started (${this.config.performanceCheckIntervalMs}ms interval)`);
  }

  /**
   * Apply performance optimizations
   */
  private applyPerformanceOptimizations(): void {
    const browserSettings = this.browserCompat.getRecommendedSettings();
    
    // Update config based on browser capabilities
    if (this.config.enablePerformanceMode) {
      this.config.maxConcurrentLayers = Math.min(
        this.config.maxConcurrentLayers,
        browserSettings.maxConcurrentLayers
      );
      
      debugLog('raw-console', `🎛️ Performance mode enabled: max ${this.config.maxConcurrentLayers} concurrent layers`);
    }

    // Apply memory constraints
    const memoryLimit = this.browserCompat.getMemoryLimit();
    if (memoryLimit < this.config.maxMemoryUsageMB) {
      this.config.maxMemoryUsageMB = memoryLimit;
      debugLog('raw-console', `💾 Memory limit adjusted to ${memoryLimit}MB`);
    }
  }

  /**
   * Setup global error handling
   */
  private setupErrorHandling(): void {
    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      if (event.reason && event.reason.toString().includes('colorCycle')) {
        this.reportError('error', 'UnhandledPromiseRejection', event.reason.toString(), undefined, {
          type: 'unhandledrejection'
        });
      }
    });

    // Catch global errors
    window.addEventListener('error', (event) => {
      if (event.filename && (event.filename.includes('colorCycle') || event.filename.includes('recolor'))) {
        this.reportError('error', 'GlobalError', event.message, undefined, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          type: 'javascript-error'
        });
      }
    });

    debugLog('raw-console', '🛡️ Global error handling setup complete');
  }

  /**
   * Update system health status
   */
  private async updateHealthStatus(): Promise<void> {
    const integrationStatus = this.integration.getStatus();
    const profilerStats = this.profiler.getCurrentStats();
    const memoryUsage = this.browserCompat.getMemoryUsage() / 1024 / 1024; // Convert to MB
    
    const issues: string[] = [];
    let status: SystemHealth['status'] = 'healthy';

    // Check memory usage
    if (memoryUsage > this.config.maxMemoryUsageMB) {
      issues.push(`High memory usage: ${memoryUsage.toFixed(1)}MB / ${this.config.maxMemoryUsageMB}MB`);
      status = 'degraded';
    }

    // Check animation performance
    if (profilerStats.recentAverageDuration > this.config.maxAnimationLatencyMs) {
      issues.push(`High animation latency: ${profilerStats.recentAverageDuration.toFixed(1)}ms`);
      status = status === 'healthy' ? 'degraded' : status;
    }

    // Check concurrent layers
    if (integrationStatus.activeRecolorLayers > this.config.maxConcurrentLayers) {
      issues.push(`Too many active layers: ${integrationStatus.activeRecolorLayers} / ${this.config.maxConcurrentLayers}`);
      status = 'critical';
    }

    // Check error rate
    const recentErrors = this.errors.filter(e => Date.now() - e.timestamp < 60000); // Last minute
    const errorRate = recentErrors.length;
    
    if (errorRate > 10) {
      issues.push(`High error rate: ${errorRate} errors/minute`);
      status = 'critical';
    } else if (errorRate > 5) {
      issues.push(`Elevated error rate: ${errorRate} errors/minute`);
      status = status === 'healthy' ? 'degraded' : status;
    }

    // Check if feature is disabled
    if (!this.config.enableColorCycleFeature) {
      status = 'disabled';
      issues.push('Feature disabled by configuration');
    }

    this.health = {
      status,
      issues,
      metrics: {
        memoryUsageMB: memoryUsage,
        avgAnimationTimeMs: profilerStats.recentAverageDuration,
        activeRecolorLayers: integrationStatus.activeRecolorLayers,
        errorRate,
        uptime: Date.now() - this.startTime
      },
      lastCheck: Date.now()
    };

    // Report health status changes
    if (issues.length > 0 && this.config.enableErrorReporting) {
      this.reportEvent('warning', 'HealthMonitor', `System health: ${status}`, {
        health: this.health
      });
    }
  }

  /**
   * Handle degraded performance
   */
  private handleDegradedPerformance(): void {
    if (this.health.status === 'critical') {
      debugWarn('raw-console', '🚨 Critical system health - applying emergency measures');
      
      if (this.config.disableOnPoorPerformance) {
        this.config.enableColorCycleFeature = false;
        this.reportEvent('warning', 'PerformanceManager', 'Feature disabled due to poor performance', {
          health: this.health
        });
      }
      
      if (this.config.fallbackToStaticMode) {
        // Could implement static mode fallback here
        debugLog('raw-console', '🔄 Falling back to static mode');
      }
    }
  }

  /**
   * Apply configuration changes
   */
  private applyConfigChanges(updates: Partial<LaunchConfig>): void {
    if (updates.performanceCheckIntervalMs && this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.setupMonitoring();
    }

    if (updates.enablePerformanceMode !== undefined) {
      this.applyPerformanceOptimizations();
    }
  }

  /**
   * Report an error
   */
  private reportError(
    level: 'error' | 'warning' | 'info',
    component: string,
    message: string,
    stack?: string,
    context: ErrorContext = {}
  ): void {
    const error: ErrorReport = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      component,
      message,
      stack,
      userAgent: navigator.userAgent,
      url: window.location.href,
      sessionId: this.sessionId,
      context
    };

    this.errors.push(error);

    // Console logging
    const logMethod = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
    logMethod(`[${component}] ${message}`, context);

    // External error reporting
    if (this.config.enableErrorReporting && this.config.errorReportingEndpoint) {
      this.sendErrorReport(error);
    }
  }

  /**
   * Report an event
   */
  private reportEvent(level: 'error' | 'warning' | 'info', component: string, message: string, context: ErrorContext = {}): void {
    this.reportError(level, component, message, undefined, context);
  }

  /**
   * Send error report to external service
   */
  private async sendErrorReport(error: ErrorReport): Promise<void> {
    if (!this.config.errorReportingEndpoint) return;

    try {
      await fetch(this.config.errorReportingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(error)
      });
    } catch (e) {
      logError('Failed to send error report:', e);
    }
  }

  /**
   * Generate default configuration
   */
  private generateDefaultConfig(): LaunchConfig {
    const browserFeatures = {
      hasMemoryAPI: this.browserCompat.isFeatureSupported('memory-api'),
      hasHighResTimer: this.browserCompat.isFeatureSupported('high-res-timer'),
      isHighPerformance: this.browserCompat.getRecommendedSettings().maxConcurrentLayers > 5
    };

    return {
      // Feature flags
      enableColorCycleFeature: true,
      enablePerformanceMode: !browserFeatures.isHighPerformance,
      enableDebugLogging: false, // Should be false in production
      enableErrorReporting: true,
      enableTelemetry: false, // User consent required

      // Performance thresholds
      maxMemoryUsageMB: browserFeatures.hasMemoryAPI ? 512 : 256,
      maxAnimationLatencyMs: 33, // 30 FPS threshold
      maxConcurrentLayers: this.browserCompat.getRecommendedSettings().maxConcurrentLayers,

      // Monitoring settings
      performanceCheckIntervalMs: browserFeatures.hasHighResTimer ? 5000 : 10000,
      
      // Fallback behavior
      disableOnHighMemoryUsage: !browserFeatures.hasMemoryAPI,
      disableOnPoorPerformance: !browserFeatures.isHighPerformance,
      fallbackToStaticMode: true
    };
  }

  /**
   * Initialize health status
   */
  private initializeHealth(): SystemHealth {
    return {
      status: 'healthy',
      issues: [],
      metrics: {
        memoryUsageMB: 0,
        avgAnimationTimeMs: 0,
        activeRecolorLayers: 0,
        errorRate: 0,
        uptime: 0
      },
      lastCheck: Date.now()
    };
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
