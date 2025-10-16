import { parseCssColor } from '@/utils/color/parseCssColor';

describe('parseCssColor', () => {
  it('parses 6-digit hex colors', () => {
    expect(parseCssColor('#336699')).toEqual({ r: 0x33, g: 0x66, b: 0x99, a: 255 });
  });

  it('parses 3-digit hex colors', () => {
    expect(parseCssColor('#0f8')).toEqual({ r: 0x00, g: 0xff, b: 0x88, a: 255 });
  });

  it('parses 8-digit hex colors with alpha', () => {
    expect(parseCssColor('#12345680')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 0x80 });
  });

  it('parses rgb() strings', () => {
    expect(parseCssColor('rgb(12, 34, 56)')).toEqual({ r: 12, g: 34, b: 56, a: 255 });
  });

  it('parses rgba() strings with decimal alpha', () => {
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 128 });
  });

  it('parses rgb() strings with percentage components', () => {
    expect(parseCssColor('rgb(100%, 50%, 0%)')).toEqual({ r: 255, g: 128, b: 0, a: 255 });
  });

  it('parses transparent keyword', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('falls back for invalid input', () => {
    expect(parseCssColor('not-a-color', { r: 1, g: 2, b: 3, a: 4 })).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });
});
