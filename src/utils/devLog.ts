/**
 * Development-only logging utility to reduce console noise in production.
 * Provides structured logging that can be easily disabled.
 */

interface LogContext {
  [key: string]: any;
}

class DevLogger {
  private enabled = process.env.NODE_ENV === 'development';
  private logLevels = {
    debug: 0,
    info: 1,
    warn: 2,  
    error: 3
  };
  private currentLevel = this.enabled ? this.logLevels.debug : this.logLevels.error;

  /**
   * Log debug information (development only)
   */
  debug(message: string, context?: LogContext): void {
    if (!this.enabled || this.currentLevel > this.logLevels.debug) return;
    
    if (context) {
      console.log(`[DEBUG] ${message}`, context);
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }

  /**
   * Log informational messages (development only)
   */
  info(message: string, context?: LogContext): void {
    if (!this.enabled || this.currentLevel > this.logLevels.info) return;
    
    if (context) {
      console.log(`[INFO] ${message}`, context);
    } else {
      console.log(`[INFO] ${message}`);
    }
  }

  /**
   * Log warnings (always shown)
   */
  warn(message: string, context?: LogContext): void {
    if (this.currentLevel > this.logLevels.warn) return;
    
    if (context) {
      console.warn(`[WARN] ${message}`, context);
    } else {
      console.warn(`[WARN] ${message}`);
    }
  }

  /**
   * Log errors (always shown)
   */
  error(message: string, error?: Error | any, context?: LogContext): void {
    if (this.currentLevel > this.logLevels.error) return;
    
    if (error && context) {
      console.error(`[ERROR] ${message}`, error, context);
    } else if (error) {
      console.error(`[ERROR] ${message}`, error);
    } else if (context) {
      console.error(`[ERROR] ${message}`, context);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  }

  /**
   * Create a scoped logger for a specific module
   */
  scope(moduleName: string) {
    return {
      debug: (message: string, context?: LogContext) => 
        this.debug(`[${moduleName}] ${message}`, context),
      info: (message: string, context?: LogContext) => 
        this.info(`[${moduleName}] ${message}`, context),
      warn: (message: string, context?: LogContext) => 
        this.warn(`[${moduleName}] ${message}`, context),
      error: (message: string, error?: Error | any, context?: LogContext) => 
        this.error(`[${moduleName}] ${message}`, error, context)
    };
  }

  /**
   * Set minimum log level (development only)
   */
  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    if (!this.enabled) return;
    this.currentLevel = this.logLevels[level];
  }

  /**
   * Temporarily disable all logging
   */
  disable(): void {
    this.currentLevel = 999;
  }

  /**
   * Re-enable logging at previous level
   */
  enable(): void {
    this.currentLevel = this.enabled ? this.logLevels.debug : this.logLevels.error;
  }
}

// Singleton instance
export const devLog = new DevLogger();

// Module-specific loggers
export const brushLog = devLog.scope('BRUSH');
export const layerLog = devLog.scope('LAYER');
export const cacheLog = devLog.scope('CACHE');
export const perfLog = devLog.scope('PERF');