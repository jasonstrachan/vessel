import type { HistoryDirection } from './actionTypes';

export type HistoryReplayErrorCode =
  | 'history-replay-drift'
  | 'history-blob-read-failed';

export interface HistoryReplayErrorDetails {
  code: HistoryReplayErrorCode;
  deltaTag: string;
  direction: HistoryDirection;
  layerId?: string;
  expected?: string | number | null;
  actual?: string | number | null;
  reason?: string;
}

export class HistoryReplayError extends Error {
  readonly code: HistoryReplayErrorCode;
  readonly deltaTag: string;
  readonly direction: HistoryDirection;
  readonly layerId?: string;
  readonly expected?: string | number | null;
  readonly actual?: string | number | null;
  readonly reason?: string;

  constructor(message: string, details: HistoryReplayErrorDetails) {
    super(message);
    this.name = 'HistoryReplayError';
    this.code = details.code;
    this.deltaTag = details.deltaTag;
    this.direction = details.direction;
    this.layerId = details.layerId;
    this.expected = details.expected;
    this.actual = details.actual;
    this.reason = details.reason;
  }
}

export class HistoryReplayDriftError extends HistoryReplayError {
  constructor(details: Omit<HistoryReplayErrorDetails, 'code'>) {
    super('History replay refused because the target state drifted.', {
      ...details,
      code: 'history-replay-drift',
    });
    this.name = 'HistoryReplayDriftError';
  }
}

export class HistoryBlobReadError extends HistoryReplayError {
  constructor(details: Omit<HistoryReplayErrorDetails, 'code'>) {
    super('History replay refused because a required blob could not be read.', {
      ...details,
      code: 'history-blob-read-failed',
    });
    this.name = 'HistoryBlobReadError';
  }
}
