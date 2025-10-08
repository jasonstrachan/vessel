import type { FieldGeneratorConfig, FieldGeneratorResult, StrokeJob } from '../types';

/**
 * Retired GPU field generator stub. Always resolves with null so callers
 * fall back to CPU implementations.
 */
export class FieldGenerator {
  constructor(_config: FieldGeneratorConfig = {}) {
    void _config;
  }

  async generate(_job: StrokeJob): Promise<FieldGeneratorResult | null> {
    void _job;
    return null;
  }
}
