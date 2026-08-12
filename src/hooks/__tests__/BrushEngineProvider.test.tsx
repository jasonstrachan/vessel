import React from 'react';
import { render, screen } from '@testing-library/react';

import {
  BrushEngineProvider,
  useBrushEngine,
} from '@/hooks/BrushEngineProvider';
import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  useBrushEngineSimplified: jest.fn(),
}));

const mockUseBrushEngineSimplified = useBrushEngineSimplified as jest.MockedFunction<
  typeof useBrushEngineSimplified
>;

const Consumer = ({ label }: { label: string }) => {
  const brushEngine = useBrushEngine();
  return <div>{`${label}:${typeof brushEngine.resetStroke}`}</div>;
};

describe('BrushEngineProvider', () => {
  it('shares one brush-engine hook instance across multiple consumers', () => {
    mockUseBrushEngineSimplified.mockReturnValue({
      resetStroke: jest.fn(),
    } as unknown as ReturnType<typeof useBrushEngineSimplified>);

    render(
      <BrushEngineProvider>
        <Consumer label="canvas" />
        <Consumer label="handlers" />
      </BrushEngineProvider>,
    );

    expect(screen.getByText('canvas:function')).toBeInTheDocument();
    expect(screen.getByText('handlers:function')).toBeInTheDocument();
    expect(mockUseBrushEngineSimplified).toHaveBeenCalledTimes(1);
  });
});
