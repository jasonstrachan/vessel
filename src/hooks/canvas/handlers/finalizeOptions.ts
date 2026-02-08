export type FinalizeOptionsInput<ActionType = string, CaptureRegion = unknown> = {
  skipSave?: boolean;
  historyActionType?: ActionType;
  historyDescription?: string;
  captureRegionOverride?: CaptureRegion | null;
};

export const resolveFinalizeOptions = <ActionType = string, CaptureRegion = unknown>(
  input?: boolean | FinalizeOptionsInput<ActionType, CaptureRegion>
): {
  options: FinalizeOptionsInput<ActionType, CaptureRegion>;
  skipSave: boolean;
  historyActionOverride: ActionType | undefined;
  historyDescriptionOverride: string | undefined;
} => {
  const options =
    typeof input === 'object' && input !== null
      ? input
      : {};
  const skipSave =
    typeof input === 'boolean'
      ? input
      : options.skipSave ?? false;
  const historyActionOverride = options.historyActionType;
  const historyDescriptionOverride = options.historyDescription;

  return {
    options,
    skipSave,
    historyActionOverride,
    historyDescriptionOverride,
  };
};
