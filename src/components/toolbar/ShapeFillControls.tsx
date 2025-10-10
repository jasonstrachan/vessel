'use client';

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { listFillStrategies } from '@/shapeFill/strategies';
import type { FillParams, ShapeFillId } from '@/shapeFill/types';
import ProgressSlider from '@/components/ui/ProgressSlider';
import CustomSwitch from '@/components/ui/CustomSwitch';

const SHAPE_FILL_STRATEGIES = listFillStrategies();

const ShapeFillControls: React.FC = () => {
  const activeFillId = useAppStore(state => state.shapeFill.activeFillId);
  const paramsByFill = useAppStore(state => state.shapeFill.paramsByFill);
  const session = useAppStore(state => state.shapeFill.session);
  const setActiveFill = useAppStore(state => state.setShapeFillActiveFill);
  const setParamValue = useAppStore(state => state.setShapeFillParamValue);

  const activeStrategy =
    SHAPE_FILL_STRATEGIES.find(strategy => strategy.id === activeFillId) ??
    SHAPE_FILL_STRATEGIES[0];

  const activeParams: Partial<FillParams> =
    paramsByFill[activeStrategy.id] ?? activeStrategy.defaults;

  const handleSelectFill = (fillId: ShapeFillId) => {
    if (fillId === activeFillId) {
      return;
    }
    setActiveFill(fillId);
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#CCCCCC] mb-2">
          Fill Type
        </h3>
        <div className="flex flex-wrap gap-2">
          {SHAPE_FILL_STRATEGIES.map(strategy => {
            const isActive = strategy.id === activeStrategy.id;
            return (
              <button
                key={strategy.id}
                type="button"
                onClick={() => handleSelectFill(strategy.id)}
                className={`px-3 py-1 text-xs font-medium border ${
                  isActive
                    ? 'bg-[#2F2F2F] border-[#6767FF] text-white'
                    : 'bg-[#1E1E1E] border-[#333333] text-[#9B9B9B]'
                } transition-colors`}
              >
                {strategy.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#CCCCCC] mb-2">
          Parameters
        </h3>
        <div className="flex flex-col gap-3">
          {activeStrategy.ui.map(control => {
            if (control.type === 'boolean') {
              const current = Boolean(activeParams[control.key] ?? control.default);
              return (
                <div
                  key={control.key}
                  className="flex items-center justify-between gap-3 text-xs text-[#CCCCCC]"
                >
                  <span>{control.label}</span>
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
              <div key={control.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs text-[#CCCCCC]">
                  <span>{control.label}</span>
                  <span className="tabular-nums text-[#9B9B9B]">
                    {numericValue.toFixed(control.step < 1 ? 2 : 0)}
                  </span>
                </div>
                <ProgressSlider
                  value={numericValue}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  onChange={value =>
                    setParamValue(activeStrategy.id, control.key, Number(value))
                  }
                  aria-label={control.label}
                />
              </div>
            );
          })}
        </div>
      </div>

      {session ? (
        <div className="rounded border border-[#333333] bg-[#111111] p-2 text-xs text-[#8E8E8E]">
          {session.stage === 'AdjustingParam' && session.currentParam ? (
            <span>
              Adjust <strong className="text-[#F0F0F0]">{session.currentParam}</strong> with the
              cursor, then click to commit.
            </span>
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
