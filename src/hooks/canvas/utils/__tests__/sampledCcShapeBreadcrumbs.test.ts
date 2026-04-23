import {
  recordSampledCcShapeBreadcrumb,
  resetSampledCcShapeBreadcrumbState,
} from '@/hooks/canvas/utils/sampledCcShapeBreadcrumbs';

const debugLog = jest.fn<void, [string, ...unknown[]]>();
const isDebugEnabled = jest.fn<boolean, [string]>(() => false);
const recordBreadcrumb = jest.fn<void, [string, unknown]>();

jest.mock('@/utils/debug', () => ({
  debugLog: (scope: string, ...args: unknown[]) => debugLog(scope, ...args),
  isDebugEnabled: (scope: string) => isDebugEnabled(scope),
  recordBreadcrumb: (scope: string, data: unknown) => recordBreadcrumb(scope, data),
}));

describe('sampledCcShapeBreadcrumbs', () => {
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    debugLog.mockReset();
    isDebugEnabled.mockReset();
    isDebugEnabled.mockReturnValue(false);
    recordBreadcrumb.mockReset();
    resetSampledCcShapeBreadcrumbState();
    nowSpy = jest.spyOn(Date, 'now');
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('dedupes identical breadcrumb payloads', () => {
    nowSpy.mockReturnValue(1000);

    recordSampledCcShapeBreadcrumb({
      event: 'pointer-down',
      pointCount: 1,
    });
    recordSampledCcShapeBreadcrumb({
      event: 'pointer-down',
      pointCount: 1,
    });

    expect(recordBreadcrumb).toHaveBeenCalledTimes(1);
    expect(recordBreadcrumb).toHaveBeenCalledWith(
      'sampled-cc-shape',
      expect.objectContaining({
        event: 'pointer-down',
        pointCount: 1,
      })
    );
  });

  it('throttles preview-frame breadcrumbs but allows a later refresh', () => {
    nowSpy.mockReturnValue(1000);
    recordSampledCcShapeBreadcrumb({
      event: 'preview-frame-start',
      rawPointCount: 10,
    });

    nowSpy.mockReturnValue(1100);
    recordSampledCcShapeBreadcrumb({
      event: 'preview-frame-start',
      rawPointCount: 11,
    });

    nowSpy.mockReturnValue(1300);
    recordSampledCcShapeBreadcrumb({
      event: 'preview-frame-start',
      rawPointCount: 12,
    });

    expect(recordBreadcrumb).toHaveBeenCalledTimes(2);
    expect(recordBreadcrumb).toHaveBeenNthCalledWith(
      2,
      'sampled-cc-shape',
      expect.objectContaining({
        event: 'preview-frame-start',
        rawPointCount: 12,
      })
    );
  });
});
