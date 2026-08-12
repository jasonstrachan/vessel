import {
  generateLayerGroupName,
  normalizeLayerGroupName,
  sanitizeHiddenLayerGroupIds,
  sanitizeLayerGroups,
} from '@/stores/layers/layerGroupService';
import type { LayerGroup } from '@/types';

describe('layerGroupService', () => {
  it('normalizes blank group names using the fallback index', () => {
    expect(normalizeLayerGroupName('  Ink  ', 2)).toBe('Ink');
    expect(normalizeLayerGroupName('   ', 2)).toBe('Group 3');
    expect(normalizeLayerGroupName(undefined, 0)).toBe('Group 1');
  });

  it('keeps only used, unique groups and normalizes names', () => {
    const layers = [
      { groupId: 'group-a' },
      { groupId: 'group-c' },
      { groupId: undefined },
    ];
    const groups: LayerGroup[] = [
      { id: 'group-a', name: '  Foreground  ' },
      { id: 'group-b', name: 'Unused' },
      { id: 'group-a', name: 'Duplicate' },
      { id: 'group-c', name: '' },
    ];

    expect(sanitizeLayerGroups(layers, groups)).toEqual([
      { id: 'group-a', name: 'Foreground' },
      { id: 'group-c', name: 'Group 4' },
    ]);
  });

  it('removes hidden ids that no longer have groups', () => {
    expect(
      sanitizeHiddenLayerGroupIds(
        ['group-a', 'group-b', 'group-c'],
        [
          { id: 'group-a', name: 'A' },
          { id: 'group-c', name: 'C' },
        ]
      )
    ).toEqual(['group-a', 'group-c']);
  });

  it('preserves, clamps, and migrates persisted Interlace settings', () => {
    expect(sanitizeLayerGroups(
      [{ groupId: 'interlace' }],
      [{
        id: 'interlace',
        name: '  Poses  ',
        kind: 'interlace',
        interlace: {
          cellSize: 0,
          dominance: 2,
          patternPreset: 'cascade' as never,
          motionMode: 'travel',
          direction: 'left',
          travelCycles: 1,
          loopDurationSeconds: 10,
          seed: 9,
        },
      }],
    )).toEqual([{
      id: 'interlace',
      name: 'Poses',
      kind: 'interlace',
      interlace: {
        cellSize: 2,
        dominance: 1,
        patternPreset: 'sierra-travel',
        motionMode: 'travel',
        direction: 'left',
        travelCycles: 1,
        loopDurationSeconds: 10,
        seed: 9,
      },
    }]);
  });

  it('generates the first unused group name starting after the current group count', () => {
    expect(generateLayerGroupName([
      { id: 'one', name: 'Group 1' },
      { id: 'three', name: 'Group 3' },
    ])).toBe('Group 4');
  });
});
