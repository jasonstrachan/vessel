import { act, render, waitFor } from '@testing-library/react';

import { ReferenceStudioBridge } from '@/components/reference/ReferenceStudioBridge';
import type {
  ReferenceStudioCommand,
  ReferenceStudioMainMessage,
} from '@/referenceStudio/referenceStudioChannel';
import { useAppStore } from '@/stores/useAppStore';
import type { Project, ReferenceAsset } from '@/types';

const postMessage = jest.fn();
const close = jest.fn();
const channel = {
  close,
  onmessage: null as ((event: MessageEvent<ReferenceStudioCommand>) => void) | null,
  postMessage,
};

jest.mock('@/referenceStudio/referenceStudioChannel', () => {
  const actual = jest.requireActual('@/referenceStudio/referenceStudioChannel');
  return {
    ...actual,
    createReferenceStudioChannel: () => channel,
  };
});

const project: Project = {
  id: 'bridge-project',
  name: 'Bridge project',
  width: 320,
  height: 480,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
  referenceAssets: [],
  referenceSamplingSource: { kind: 'canvas' },
};

const asset: ReferenceAsset = {
  id: 'bridge-reference',
  name: 'Portrait',
  dataUrl: 'data:image/png;base64,AAAA',
  naturalWidth: 20,
  naturalHeight: 30,
  visible: true,
  locked: false,
  opacity: 1,
  x: -10,
  y: 0,
  scale: 1,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  flipX: false,
  flipY: false,
  createdAt: 1,
  updatedAt: 1,
};

const deliver = (message: ReferenceStudioCommand): void => {
  channel.onmessage?.({ data: message } as MessageEvent<ReferenceStudioCommand>);
};

describe('ReferenceStudioBridge', () => {
  const originalState = useAppStore.getState();

  beforeEach(() => {
    jest.clearAllMocks();
    channel.onmessage = null;
    useAppStore.setState((state) => ({
      project,
      layers: [],
      referenceLayerId: null,
      colorPickerPreferReferenceLayer: false,
      ui: {
        ...state.ui,
        grid: { enabled: false, rows: 8, columns: 8 },
      },
      autosave: {
        ...state.autosave,
        isSessionSyncSuspended: true,
      },
    }));
  });

  afterAll(() => {
    useAppStore.setState(originalState, true);
  });

  it('synchronizes commands into the main store and publishes updated snapshots', async () => {
    const view = render(<ReferenceStudioBridge />);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'snapshot',
      snapshot: expect.objectContaining({
        project: expect.objectContaining({ id: project.id }),
        grid: { enabled: false, rows: 8, columns: 8 },
      }),
    } satisfies Partial<ReferenceStudioMainMessage>));

    act(() => {
      deliver({ type: 'set-grid', grid: { enabled: true, rows: 12, columns: 10 } });
      deliver({ type: 'add-reference', asset });
      deliver({ type: 'set-sampling-source', source: { kind: 'asset', assetId: asset.id } });
    });

    expect(useAppStore.getState().ui.grid).toEqual({ enabled: true, rows: 12, columns: 10 });
    expect(useAppStore.getState().project?.referenceAssets).toEqual([asset]);
    expect(useAppStore.getState().project?.referenceSamplingSource).toEqual({
      kind: 'asset',
      assetId: asset.id,
    });

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'snapshot',
        snapshot: expect.objectContaining({
          grid: { enabled: true, rows: 12, columns: 10 },
          samplingSource: { kind: 'asset', assetId: asset.id },
        }),
      }));
    });

    act(() => deliver({ type: 'studio-ready' }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'snapshot' }));

    view.unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
