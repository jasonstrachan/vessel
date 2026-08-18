import { act, renderHook } from '@testing-library/react';

import { getAppStoreState } from '@/stores/appStoreAccess';
import type { TxtShapeFontFamily } from '@/types';
import { subscribeTxtShapeMonoRasterRevision } from '@/utils/txtShapeMonoRenderer';

import { useTxtShapeRasterInvalidation } from '../useTxtShapeRasterInvalidation';

jest.mock('@/stores/appStoreAccess', () => ({
  getAppStoreState: jest.fn(),
}));

jest.mock('@/utils/txtShapeMonoRenderer', () => ({
  subscribeTxtShapeMonoRasterRevision: jest.fn(),
}));

describe('useTxtShapeRasterInvalidation', () => {
  it('recomposes only layers using the face that became ready', () => {
    let listener: ((family: TxtShapeFontFamily) => void) | null = null;
    const unsubscribe = jest.fn();
    jest.mocked(subscribeTxtShapeMonoRasterRevision).mockImplementation((nextListener) => {
      listener = nextListener;
      return unsubscribe;
    });
    const markCompositeSegmentsDirtyByLayerIds = jest.fn();
    jest.mocked(getAppStoreState).mockReturnValue({
      project: {
        txtShapes: [
          { layerId: 'mek-layer', fontFamily: 'mek-mono' },
          { layerId: 'mek-layer', fontFamily: 'mek-mono' },
          { layerId: 'tiny-layer', fontFamily: 'tiny5' },
        ],
      },
      markCompositeSegmentsDirtyByLayerIds,
    } as unknown as ReturnType<typeof getAppStoreState>);

    const { unmount } = renderHook(() => useTxtShapeRasterInvalidation());
    act(() => listener?.('mek-mono'));

    expect(markCompositeSegmentsDirtyByLayerIds).toHaveBeenCalledWith(['mek-layer'], {
      requestRecomposition: true,
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
