import { deserializeProject, serializeProject } from '@/utils/projectIO';
import type { Project } from '@/types';

test('opaque extension data survives the actual project archive round trip', async () => {
  const project: Project = {
    id: 'extension-test', name: 'Extension test', width: 8, height: 8, layers: [], layerGroups: [],
    backgroundColor: 'transparent', createdAt: new Date(), updatedAt: new Date(), customBrushes: [],
    extensionData: { 'test-extension': { version: 1, buffers: { first: { length: 2, chunks: [[0, 'AQEBAg==']] } }, events: [{ id: 'mark-1', label: '<shape>' }] } },
  };
  const restored = await deserializeProject(await serializeProject(project));
  expect(restored.extensionData).toEqual(project.extensionData);
});
