type FeedbackHandler = (message: string) => void;

let feedbackHandler: FeedbackHandler | null = null;

export const setAppFeedbackHandler = (handler: FeedbackHandler | null): void => {
  feedbackHandler = handler;
};

export const showAppFeedback = (message: string): void => {
  feedbackHandler?.(message);
};
