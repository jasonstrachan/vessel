'use client';

import Button from '@/components/ui/Button';
import {
  GobletReleaseActions,
  GobletReleaseSummary,
} from '@/components/modals/GobletReleasePanel';
import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import type { GobletPublisher } from '@/utils/export/goblet/gobletPublisherRegistry';

import {
  formatExactBytes,
  LAYER_PROGRESS_LABELS,
  SINGLE_HTML_BREAKDOWN_ROWS,
  type ExportProgressState,
} from './exportModalModel';

interface ExportProgressViewProps {
  state: ExportProgressState;
  publishingPublisherId: string | null;
  onBack: () => void;
  onCancel: () => void;
  onClose: () => void;
  onContinueAnyway: () => void;
  onRepair: () => void;
  onDownload: (artifact: GobletArtifact) => void;
  onPublish: (publisher: GobletPublisher, artifact: GobletArtifact) => void;
}

export const canDismissExportProgress = (
  state: ExportProgressState,
  publishingPublisherId: string | null,
): boolean => (
  (state.phase === 'complete' || state.phase === 'failed')
  && publishingPublisherId === null
);

export const ExportProgressView = ({
  state,
  publishingPublisherId,
  onBack,
  onCancel,
  onClose,
  onContinueAnyway,
  onRepair,
  onDownload,
  onPublish,
}: ExportProgressViewProps) => {
  const artifact = state.artifact;
  const canClose = canDismissExportProgress(state, publishingPublisherId);
  const isBlocked = state.phase === 'blocked';
  const diagnosticsText = state.layers
    .flatMap((layer) => layer.colorCycle?.diagnostics
      ?.map((diagnostic) => `${layer.name}: ${diagnostic}`) ?? [])
    .join('\n');
  const singleHtmlBreakdown = state.phase === 'complete'
    && state.sizeReport?.format === 'single-html'
    ? state.sizeReport.singleHtmlBreakdown
    : undefined;

  const copyDiagnostics = () => {
    if (diagnosticsText && typeof navigator !== 'undefined') {
      void navigator.clipboard?.writeText(diagnosticsText);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {state.issue && (
          <div className="border border-[#735B2D] bg-[#261F12] px-3 py-2">
            <div className="text-sm font-semibold text-[#F0D9A0]">{state.issue.title}</div>
            <div className="mt-2 space-y-1">
              {state.issue.detailLines.map((line) => (
                <div key={line} className="text-sm text-[#E7D6B4]">{line}</div>
              ))}
            </div>
            {state.issue.repairHint && (
              <div className="mt-2 text-xs text-[#C8B88E]">{state.issue.repairHint}</div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[#E5E5E5]">{state.message}</span>
            <span className="text-[#9C9C9C]">{Math.round(state.percent)}%</span>
          </div>
          <div className="h-2 overflow-hidden bg-[#353535]">
            <div
              className="h-full bg-[#D9D9D9] transition-all"
              style={{ width: `${Math.max(0, Math.min(100, state.percent))}%` }}
            />
          </div>
          {state.excludedHiddenLayerCount > 0 && (
            <div className="text-xs text-[#9C9C9C]" data-testid="excluded-hidden-layer-summary">
              {state.excludedHiddenLayerCount} hidden layer{state.excludedHiddenLayerCount === 1 ? '' : 's'} excluded
            </div>
          )}
        </div>

        {state.layers.length > 0 && (
          <div className="space-y-2" data-testid="export-progress-layer-list">
            {state.layers.map((layer) => (
              <div
                key={layer.id}
                className="grid grid-cols-[1fr_auto] gap-3 border border-[#343434] bg-[#1F1F1F] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-[#E5E5E5]">{layer.name}</div>
                  {layer.message && (
                    <div className="truncate text-xs text-[#9C9C9C]">{layer.message}</div>
                  )}
                  {layer.colorCycle?.source && (
                    <div className="truncate text-xs text-[#9C9C9C]">
                      {layer.colorCycle.source}
                      {typeof layer.colorCycle.nonZeroPaint === 'number'
                        && layer.colorCycle.nonZeroPaint >= 0
                        ? ` - ${layer.colorCycle.nonZeroPaint}/${layer.colorCycle.payloadPixels ?? '?'} px`
                        : ''}
                    </div>
                  )}
                  {layer.colorCycle?.diagnostics && layer.colorCycle.diagnostics.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {layer.colorCycle.diagnostics.slice(0, 2).map((diagnostic) => (
                        <div key={diagnostic} className="truncate text-xs text-[#F0D9A0]">
                          {diagnostic}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="whitespace-nowrap text-xs text-[#9C9C9C]">
                  {LAYER_PROGRESS_LABELS[layer.status]}
                </div>
              </div>
            ))}
          </div>
        )}

        {singleHtmlBreakdown && state.sizeReport && (
          <div
            className="border border-[#424242] bg-[#1F1F1F] px-3 py-3"
            data-testid="single-html-size-breakdown"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-[#E5E5E5]">Single HTML size</span>
              <span className="text-sm tabular-nums text-[#E5E5E5]">
                {formatExactBytes(state.sizeReport.totalBytes)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1">
              {SINGLE_HTML_BREAKDOWN_ROWS.map(({ key, label }) => {
                const bytes = singleHtmlBreakdown[key];
                if (bytes <= 0) {
                  return null;
                }
                const percentage = state.sizeReport!.totalBytes > 0
                  ? (bytes / state.sizeReport!.totalBytes) * 100
                  : 0;
                return (
                  <div
                    key={key}
                    className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs"
                    data-bytes={bytes}
                    data-percentage={percentage}
                    data-testid={`single-html-size-${key}`}
                  >
                    <span className="text-[#9C9C9C]">{label}</span>
                    <span className="tabular-nums text-[#E5E5E5]">{formatExactBytes(bytes)}</span>
                    <span className="w-12 text-right tabular-nums text-[#9C9C9C]">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {state.phase === 'complete' && artifact && (
          <GobletReleaseSummary artifact={artifact} />
        )}

        {diagnosticsText && (
          <div className="flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={copyDiagnostics}>
              Copy diagnostics
            </Button>
          </div>
        )}

        {state.error && (
          <div className="border border-[#7A3A3A] bg-[#2A1717] px-3 py-2">
            <div className="text-sm font-semibold text-[#F1B3B3]">Export failed</div>
            <div className="mt-1 text-sm text-[#F1D0D0]">{state.error.message}</div>
            {state.error.stack && (
              <details className="mt-2 text-xs text-[#D7B8B8]">
                <summary className="cursor-pointer">Details</summary>
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap">
                  {state.error.stack}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-[#424242] bg-[#252525] px-5 py-3">
        {isBlocked ? (
          <>
            <Button variant="secondary" onClick={onBack}>Back</Button>
            <Button variant="secondary" onClick={onRepair}>Repair...</Button>
            <Button variant="primary" onClick={onContinueAnyway}>Continue anyway</Button>
          </>
        ) : state.phase === 'complete' && state.kind === 'webgl' && artifact ? (
          <GobletReleaseActions
            artifact={artifact}
            publishingPublisherId={publishingPublisherId}
            onClose={onClose}
            onDownload={onDownload}
            onPublish={onPublish}
          />
        ) : state.phase === 'failed' ? (
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={onBack}>Back to settings</Button>
          </>
        ) : canClose ? (
          <Button variant="primary" onClick={onClose}>Close</Button>
        ) : (
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </>
  );
};
