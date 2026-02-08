import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import { useUserBrushEngine } from '@/hooks/useUserBrushEngine';

export const useDrawingHandlersEngineRuntimes = () => {
  const brushEngine = useBrushEngineSimplified();
  const userBrushEngine = useUserBrushEngine();

  return {
    brushEngine,
    userBrushEngine,
  };
};
