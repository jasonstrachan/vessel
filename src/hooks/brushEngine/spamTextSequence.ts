const SPAM_TEXTS: Record<string, string> = {
  classic: 'WINNER!!! ACT NOW!!! LIMITED TIME OFFER!!! CONGRATULATIONS!!! FREE FREE FREE!!! CLICK HERE!!! URGENT MESSAGE!!! HOT SINGLES IN YOUR AREA!!! 100% GUARANTEED!!! NO RISK!!! CALL NOW!!! AMAZING OFFER!!! EARN $$$!!! LOSE WEIGHT FAST!!! MIRACLE CURE!!! SECRET REVEALED!!! ',
  crypto: 'TO THE MOON!!! HODL!!! DIAMOND HANDS!!! BUY THE DIP!!! WHALE ALERT!!! 100X GAINS!!! PUMP IT!!! NOT FINANCIAL ADVICE!!! LAMBO SOON!!! MOON MISSION!!! GEM FOUND!!! RUG PROOF!!! DYOR!!! APE IN NOW!!! ',
  prince: 'DEAR BENEFICIARY!!! INHERITANCE FUND!!! BANK OF NIGERIA!!! TRANSFER FEES REQUIRED!!! MILLION DOLLARS!!! TRUSTED BARRISTER!!! URGENT RESPONSE NEEDED!!! STRICTLY CONFIDENTIAL!!! GOD BLESS!!! AWAITING YOUR REPLY!!! KINDLY SEND DETAILS!!! WESTERN UNION!!! ',
  pharma: 'CHEAP MEDS!!! NO PRESCRIPTION!!! FDA APPROVED!!! GENERIC PILLS!!! DISCREET SHIPPING!!! ONLINE PHARMACY!!! SPECIAL PRICE!!! ORDER TODAY!!! DOCTOR APPROVED!!! SAFE & EFFECTIVE!!! FAST DELIVERY!!! ',
  mixed: 'WINNER!!! TO THE MOON!!! DEAR BENEFICIARY!!! CHEAP MEDS!!! ACT NOW!!! HODL!!! BANK OF NIGERIA!!! FDA APPROVED!!! FREE FREE FREE!!! DIAMOND HANDS!!! MILLION DOLLARS!!! SPECIAL PRICE!!! 100% GUARANTEED!!! PUMP IT!!! URGENT!!! ',
};

export interface SpamTextState {
  currentText: string;
  charIndex: number;
  initialized: boolean;
}

export class SpamTextSequence {
  private state: SpamTextState = {
    currentText: '',
    charIndex: 0,
    initialized: false,
  };

  getNextChar(): string {
    if (!this.state.currentText) {
      return 'S';
    }

    const char = this.state.currentText[this.state.charIndex % this.state.currentText.length];
    this.state.charIndex += 1;
    return char;
  }

  initialize(contentType: string, customText?: string): void {
    if (customText && customText.trim().length > 0) {
      this.state.currentText = customText;
    } else {
      this.state.currentText = SPAM_TEXTS[contentType] || SPAM_TEXTS.mixed;
    }

    if (!this.state.initialized) {
      this.state.charIndex = 0;
      this.state.initialized = true;
    }
  }

  reset(): void {
    this.state.charIndex = 0;
    this.state.initialized = false;
  }

  getState(): SpamTextState {
    return this.state;
  }
}
