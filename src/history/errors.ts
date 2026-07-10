import type { HistoryActionId, HistoryDirection } from './actionTypes';

export type HistoryReplayErrorCode =
  | 'history-replay-drift'
  | 'history-blob-read-failed'
  | 'history-replay-preparation-failed'
  | 'history-replay-apply-failed'
  | 'history-replay-recovery-failed'
  | 'history-replay-in-progress'
  | 'history-replay-faulted';

export interface HistoryReplayErrorDetails {
  code: HistoryReplayErrorCode;
  deltaTag: string;
  direction: HistoryDirection;
  layerId?: string;
  expected?: string | number | null;
  actual?: string | number | null;
  reason?: string;
  entryId?: string;
  action?: HistoryActionId;
  phase?: 'prepare' | 'apply' | 'rehydrate' | 'compensate' | 'recovery-rehydrate';
  appliedDeltaTags?: string[];
  compensationSucceeded?: boolean;
}

export class HistoryReplayError extends Error {
  readonly code: HistoryReplayErrorCode;
  readonly deltaTag: string;
  readonly direction: HistoryDirection;
  readonly layerId?: string;
  readonly expected?: string | number | null;
  readonly actual?: string | number | null;
  readonly reason?: string;
  readonly entryId?: string;
  readonly action?: HistoryActionId;
  readonly phase?: HistoryReplayErrorDetails['phase'];
  readonly appliedDeltaTags?: string[];
  readonly compensationSucceeded?: boolean;

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
    this.entryId = details.entryId;
    this.action = details.action;
    this.phase = details.phase;
    this.appliedDeltaTags = details.appliedDeltaTags;
    this.compensationSucceeded = details.compensationSucceeded;
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

export class HistoryReplayPreparationError extends HistoryReplayError {
  readonly cause: unknown;

  constructor(details: Omit<HistoryReplayErrorDetails, 'code'>, cause: unknown) {
    super('History replay could not be prepared without changing the document.', {
      ...details,
      code: 'history-replay-preparation-failed',
    });
    this.name = 'HistoryReplayPreparationError';
    this.cause = cause;
  }
}

export class HistoryReplayApplyError extends HistoryReplayError {
  readonly cause: unknown;

  constructor(details: Omit<HistoryReplayErrorDetails, 'code'>, cause: unknown) {
    super('History replay failed and the document was restored to its prior state.', {
      ...details,
      code: 'history-replay-apply-failed',
    });
    this.name = 'HistoryReplayApplyError';
    this.cause = cause;
  }
}

export class HistoryReplayRecoveryError extends HistoryReplayError {
  readonly cause: unknown;
  readonly recoveryCause: unknown;

  constructor(
    details: Omit<HistoryReplayErrorDetails, 'code'>,
    cause: unknown,
    recoveryCause: unknown,
  ) {
    super('History replay recovery failed; history is locked until it is cleared.', {
      ...details,
      code: 'history-replay-recovery-failed',
    });
    this.name = 'HistoryReplayRecoveryError';
    this.cause = cause;
    this.recoveryCause = recoveryCause;
  }
}

export class HistoryReplayInProgressError extends HistoryReplayError {
  constructor(direction: HistoryDirection) {
    super('History replay is already in progress.', {
      code: 'history-replay-in-progress',
      deltaTag: 'history-manager',
      direction,
    });
    this.name = 'HistoryReplayInProgressError';
  }
}

export class HistoryReplayFaultedError extends HistoryReplayError {
  readonly fault: HistoryReplayRecoveryError;

  constructor(direction: HistoryDirection, fault: HistoryReplayRecoveryError) {
    super('History replay is locked because recovery previously failed.', {
      code: 'history-replay-faulted',
      deltaTag: 'history-manager',
      direction,
      reason: fault.message,
    });
    this.name = 'HistoryReplayFaultedError';
    this.fault = fault;
  }
}
