import { useEffect } from 'react';

import { getAppStoreState } from '@/stores/appStoreAccess';
import type { TxtShapeFontFamily } from '@/types';
import { subscribeTxtShapeMonoRasterRevision } from '@/utils/txtShapeMonoRenderer';

export const useTxtShapeRasterInvalidation = (): void => {
  useEffect(() => subscribeTxtShapeMonoRasterRevision((fontFamily: TxtShapeFontFamily) => {
    const state = getAppStoreState();
    const layerIds = [...new Set((state.project?.txtShapes ?? []).flatMap((shape) => (
      shape.fontFamily === fontFamily && shape.layerId ? [shape.layerId] : []
    )))];
    if (layerIds.length === 0) return;
    state.markCompositeSegmentsDirtyByLayerIds(layerIds, {
      requestRecomposition: true,
    });
  }), []);
};
