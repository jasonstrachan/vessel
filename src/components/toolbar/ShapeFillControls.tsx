'use client';

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { listFillStrategies } from '@/shapeFill/strategies';
import type { FillParams, ShapeFillId } from '@/shapeFill/types';
import ProgressSlider from '@/components/ui/ProgressSlider';
import CustomSwitch from '@/components/ui/CustomSwitch';
import ButtonGroup from '@/components/ui/ButtonGroup';

const SHAPE_FILL_STRATEGIES = listFillStrategies();

const ShapeFillControls: React.FC = () => {
  const activeFillId = useAppStore(state => state.shapeFill.activeFillId);
  const paramsByFill = useAppStore(state => state.shapeFill.paramsByFill);
  const session = useAppStore(state => state.shapeFill.session);
  const showOutline = useAppStore(state => state.shapeFill.showOutline);
  const sampleUnderShape = useAppStore(state => state.shapeFill.sampleUnderShape);
  const setActiveFill = useAppStore(state => state.setShapeFillActiveFill);
  const setParamValue = useAppStore(state => state.setShapeFillParamValue);
  const setShowOutline = useAppStore(state => state.setShapeFillShowOutline);
  const setSampleUnderShape = useAppStore(state => state.setShapeFillSampleUnderShape);

  const activeStrategy =
    SHAPE_FILL_STRATEGIES.find(strategy => strategy.id === activeFillId) ??
    SHAPE_FILL_STRATEGIES[0];

  const baseParams = React.useMemo(() => {
    return {
      ...activeStrategy.defaults,
      ...(paramsByFill[activeStrategy.id] ?? {}),
    } as Partial<FillParams>;
  }, [activeStrategy, paramsByFill]);

  const activeParams = React.useMemo<Partial<FillParams>>(() => {
    if (session && session.stage !== 'Drawing') {
      return {
        ...baseParams,
        ...(session.params ?? {}),
      };
    }
    return baseParams;
  }, [baseParams, session]);

  const handleSelectFill = (fillId: ShapeFillId) => {
    if (fillId === activeFillId) {
      return;
    }
    setActiveFill(fillId);
  };

  const fillOptions = React.useMemo(
    () => SHAPE_FILL_STRATEGIES.map(strategy => ({ label: strategy.label, value: strategy.id })),
    []
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      <ButtonGroup
        options={fillOptions}
        value={activeStrategy.id}
        onChange={value => handleSelectFill(value as ShapeFillId)}
        size="sm"
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-xs text-[#CCCCCC]">
          <span className="w-24">Sample</span>
          <CustomSwitch
            checked={sampleUnderShape}
            onChange={checked => setSampleUnderShape(checked)}
            aria-label="Sample"
          />
        </div>

        {activeStrategy.ui.map(control => {
          if (control.type === 'boolean') {
            const value = activeParams[control.key];
            const current = typeof value === 'boolean' ? value : Boolean(value ?? control.default);
            return (
              <div
                key={control.key}
                className="flex items-center gap-3 text-xs text-[#CCCCCC]"
              >
                <span className="w-24">{control.label}</span>
                <CustomSwitch
                  checked={current}
                  onChange={checked => setParamValue(activeStrategy.id, control.key, checked)}
                  aria-label={control.label}
                />
              </div>
            );
          }

          const numericValue =
            typeof activeParams[control.key] === 'number'
              ? (activeParams[control.key] as number)
              : control.default;

          return (
            <div key={control.key} className="flex items-center gap-3 text-xs text-[#CCCCCC]">
              <span className="w-24">{control.label}</span>
              <ProgressSlider
                value={numericValue}
                min={control.min}
                max={control.max}
                step={control.step}
                onChange={value => {
                  const raw = typeof value === 'number' ? value : Number(value);
                  const nextValue = control.step >= 1 ? Math.round(raw) : raw;
                  setParamValue(activeStrategy.id, control.key, nextValue);
                }}
                aria-label={control.label}
                className="flex-1"
              />
            </div>
          );
        })}
        <div className="flex items-center gap-3 text-xs text-[#CCCCCC]">
          <span className="w-24">Show Outline</span>
          <CustomSwitch
            checked={showOutline}
            onChange={checked => setShowOutline(checked)}
            aria-label="Show Outline"
          />
        </div>
      </div>

      {session ? (
        <div className="rounded border border-[#333333] bg-[#111111] p-2 text-xs text-[#8E8E8E]">
          {session.stage === 'AdjustingParam' && session.currentParam ? (
            (() => {
              const currentParam = session.currentParam;
              const control = activeStrategy.ui.find(item => item.key === currentParam);
              const rawValue = activeParams[currentParam];
              const formattedValue =
                typeof rawValue === 'number'
                  ? rawValue.toFixed(control && control.type === 'number' && control.step < 1 ? 2 : 0)
                  : rawValue === undefined
                    ? undefined
                    : String(rawValue);

              return (
                <span>
                  <strong className="text-[#F0F0F0]">{currentParam}</strong>
                  {formattedValue !== undefined ? (
                    <span className="ml-2 text-[#C6C6C6] tabular-nums">{formattedValue}</span>
                  ) : null}
                </span>
              );
            })()
          ) : session.stage === 'Drawing' ? (
            <span>Draw a shape to begin adjusting parameters.</span>
          ) : (
            <span>Shape fill ready. Press Enter to commit or Esc to cancel.</span>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ShapeFillControls;
