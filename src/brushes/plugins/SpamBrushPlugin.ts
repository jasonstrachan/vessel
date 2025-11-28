import { BaseBrushPlugin, BrushDrawContext, BrushMetadata, BrushConfig } from '../BrushPlugin';
import { BrushSettings } from '../../types';

const SPAM_CONTENT = {
  classic: [
    'WINNER!!!', 'ACT NOW', 'LIMITED TIME', 'CONGRATULATIONS', 
    'FREE FREE FREE', 'CLICK HERE', 'URGENT!!!', 'HOT SINGLES',
    '100% GUARANTEED', 'NO RISK', 'CALL NOW', 'AMAZING OFFER',
    'EARN $$$', 'LOSE WEIGHT FAST', 'MIRACLE CURE', 'SECRET REVEALED',
    'EXCLUSIVE DEAL', 'INSTANT APPROVAL', 'LOWEST PRICES', 'RISK FREE'
  ],
  crypto: [
    'TO THE MOON', 'HODL', 'DIAMOND HANDS', 'BUY THE DIP',
    'WHALE ALERT', '100X GAINS', 'PUMP IT', 'NOT FINANCIAL ADVICE',
    'LAMBO SOON', 'MOON MISSION', 'GEM FOUND', 'RUG PROOF'
  ],
  prince: [
    'DEAR BENEFICIARY', 'INHERITANCE FUND', 'BANK OF NIGERIA',
    'TRANSFER FEES', 'MILLION DOLLARS', 'TRUSTED BARRISTER',
    'URGENT RESPONSE', 'STRICTLY CONFIDENTIAL', 'GOD BLESS',
    'AWAITING YOUR REPLY', 'KINDLY SEND', 'WESTERN UNION'
  ],
  pharma: [
    'CHEAP MEDS', 'NO PRESCRIPTION', 'FDA APPROVED', 'GENERIC PILLS',
    'DISCREET SHIPPING', 'ONLINE PHARMACY', 'SPECIAL PRICE',
    'ORDER TODAY', 'DOCTOR APPROVED', 'SAFE & EFFECTIVE'
  ],
  mixed: [] as string[]
};

// Initialize mixed content
SPAM_CONTENT.mixed = [
  ...SPAM_CONTENT.classic,
  ...SPAM_CONTENT.crypto,
  ...SPAM_CONTENT.prince,
  ...SPAM_CONTENT.pharma
];

const SPECIAL_CHARS = ['$$$', '!!!', '***', '###', '@@@', '%%%', '&&&', '^^^'];
const NUMBERS = ['100%', '24/7', '#1', '999', '2023', '50% OFF', '$1000000'];

export const SPAM_FONTS = [
  { id: 'courier', name: 'Courier New', value: 'Courier New, monospace' },
  { id: 'consolas', name: 'Consolas', value: 'Consolas, monospace' },
  { id: 'monaco', name: 'Monaco', value: 'Monaco, monospace' },
  { id: 'lucida', name: 'Lucida Console', value: 'Lucida Console, monospace' },
  { id: 'roboto', name: 'Roboto Mono', value: 'Roboto Mono, monospace' },
  { id: 'source', name: 'Source Code Pro', value: 'Source Code Pro, monospace' },
  { id: 'terminal', name: 'Terminal', value: 'Terminal, monospace' },
  { id: 'menlo', name: 'Menlo', value: 'Menlo, monospace' }
];

export class SpamBrushPlugin extends BaseBrushPlugin {
  readonly id = 'spam-brush';
  readonly metadata: BrushMetadata = {
    id: 'spam-brush',
    name: 'Spam Text',
    description: 'Paint with spam email text in fixed-width fonts',
    author: 'Vessel Team',
    version: '1.0.0',
    category: 'Text',
    tags: ['spam', 'text', 'typography', 'artistic'],
  };

  private currentFont = 'Courier New, monospace';
  private contentType: keyof typeof SPAM_CONTENT = 'mixed';
  private charIndex = 0;
  private lastX = 0;
  private lastY = 0;
  private minDistance = 10;

  performanceHints = {
    preferredFPS: 60,
    usesGPU: false,
    requiresImageData: false,
    maxStrokePoints: 1000
  };

  initialize(config?: BrushConfig): void {
    if (typeof config?.font === 'string') {
      const fontConfig = SPAM_FONTS.find(f => f.id === config.font);
      this.currentFont = fontConfig?.value || SPAM_FONTS[0].value;
    }
    if (typeof config?.contentType === 'string' && config.contentType in SPAM_CONTENT) {
      this.contentType = config.contentType as keyof typeof SPAM_CONTENT;
    }
    this.charIndex = Math.floor(Math.random() * SPAM_CONTENT[this.contentType].length);
  }

  onActivate(): void {
    console.log('Spam Text brush activated with font:', this.currentFont);
  }

  onDeactivate(): void {
    console.log('Spam Text brush deactivated');
  }

  private getNextSpamText(): string {
    const content = SPAM_CONTENT[this.contentType];
    if (content.length === 0) return 'SPAM';
    
    // Mix in special chars and numbers randomly
    if (Math.random() < 0.2) {
      return SPECIAL_CHARS[Math.floor(Math.random() * SPECIAL_CHARS.length)];
    }
    if (Math.random() < 0.15) {
      return NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
    }
    
    const text = content[this.charIndex % content.length];
    this.charIndex++;
    return text;
  }

  draw(context: BrushDrawContext): void {
    const { ctx, x, y, pressure, settings } = context;
    
    // Calculate distance from last point
    const distance = Math.hypot(x - this.lastX, y - this.lastY);
    
    // Only draw if we've moved enough distance
    if (distance < this.minDistance && context.lastPoint) {
      return;
    }
    
    const fontSize = Math.round(settings.size * (pressure || 1));
    const text = this.getNextSpamText();
    
    ctx.save();
    ctx.font = `${fontSize}px ${this.currentFont}`;
    ctx.fillStyle = settings.color;
    ctx.globalAlpha = settings.opacity * (pressure || 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Add slight rotation for chaos
    const rotation = (Math.random() - 0.5) * 0.2;
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillText(text, 0, 0);
    
    ctx.restore();
    
    this.lastX = x;
    this.lastY = y;
  }

  drawLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    settings: BrushSettings
  ): void {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(distance / this.minDistance));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      
      this.draw({
        ctx,
        x,
        y,
        pressure: 1,
        settings,
        lastPoint: i === 0 ? null : { x: x1 + (x2 - x1) * ((i - 1) / steps), y: y1 + (y2 - y1) * ((i - 1) / steps), pressure: 1 }
      });
    }
  }

  validateSettings(settings: BrushSettings): boolean {
    if (settings.size < 8 || settings.size > 72) {
      console.warn('Spam Text brush works best with size between 8 and 72');
    }
    return true;
  }

  cleanup(): void {
    this.charIndex = 0;
    this.lastX = 0;
    this.lastY = 0;
  }

  getControls(): React.ComponentType | null {
    return null;
  }

  // Public method to change font
  setFont(fontId: string): void {
    const fontConfig = SPAM_FONTS.find(f => f.id === fontId);
    if (fontConfig) {
      this.currentFont = fontConfig.value;
    }
  }

  // Public method to change content type
  setContentType(type: keyof typeof SPAM_CONTENT): void {
    if (type in SPAM_CONTENT) {
      this.contentType = type;
      this.charIndex = Math.floor(Math.random() * SPAM_CONTENT[this.contentType].length);
    }
  }
}

export default SpamBrushPlugin;
