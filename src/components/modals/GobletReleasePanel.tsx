'use client';

import React, { useEffect, useState } from 'react';

import Button from '@/components/ui/Button';
import {
  getGobletArtifactHealth,
  type GobletArtifact,
} from '@/utils/export/goblet/gobletArtifact';
import { hydrateHostGobletPublishers } from '@/utils/export/goblet/gobletPublisherManifest';
import {
  getGobletPublishers,
  subscribeGobletPublishers,
  type GobletPublisher,
} from '@/utils/export/goblet/gobletPublisherRegistry';

interface GobletReleaseSummaryProps {
  artifact: GobletArtifact;
}

export const GobletReleaseSummary: React.FC<GobletReleaseSummaryProps> = ({ artifact }) => {
  const [isPreviewVisible, setIsPreviewVisible] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const healthMetrics = getGobletArtifactHealth(artifact);

  useEffect(() => {
    if (artifact.blob.type !== 'text/html') {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(artifact.blob);
    setPreviewUrl(url);
    setIsPreviewVisible(true);
    return () => URL.revokeObjectURL(url);
  }, [artifact]);

  return (
    <>
      <div className="border border-[#424242] bg-[#1F1F1F] px-3 py-2.5">
        <div className="text-sm font-semibold text-[#E5E5E5]">Release health</div>
        <div className="mt-1.5 grid grid-cols-2 gap-x-5 gap-y-1">
          {healthMetrics.map((metric) => (
            <div key={metric.id} className="grid grid-cols-[1fr_auto] gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-[#9C9C9C]">
                <span
                  aria-label={metric.status === 'warning' ? 'Check' : 'Ready'}
                  className={`h-1.5 w-1.5 shrink-0 ${metric.status === 'warning' ? 'bg-[#F0D9A0]' : 'bg-[#9BC8A4]'}`}
                  role="img"
                />
                <span className="truncate">{metric.label}</span>
              </span>
              <span className="tabular-nums text-[#E5E5E5]">{metric.value}</span>
            </div>
          ))}
        </div>
      </div>

      {previewUrl && (
        <div className="border border-[#424242] bg-[#111]">
          <div className="flex items-center justify-between border-b border-[#424242] px-3 py-2">
            <span className="text-sm font-semibold text-[#E5E5E5]">Exact artifact preview</span>
            <button
              type="button"
              className="text-xs text-[#9C9C9C] hover:text-white"
              onClick={() => setIsPreviewVisible((visible) => !visible)}
            >
              {isPreviewVisible ? 'Hide' : 'Show'}
            </button>
          </div>
          {isPreviewVisible && (
            <iframe
              className="h-[320px] w-full border-0 bg-black"
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin"
              title="Goblet artifact preview"
            />
          )}
        </div>
      )}
    </>
  );
};

interface GobletReleaseActionsProps {
  artifact: GobletArtifact;
  publishingPublisherId: string | null;
  onClose: () => void;
  onDownload: (artifact: GobletArtifact) => void;
  onPublish: (publisher: GobletPublisher, artifact: GobletArtifact) => void;
}

export const GobletReleaseActions: React.FC<GobletReleaseActionsProps> = ({
  artifact,
  publishingPublisherId,
  onClose,
  onDownload,
  onPublish,
}) => {
  const [publishers, setPublishers] = useState<GobletPublisher[]>(getGobletPublishers);

  useEffect(() => {
    const refresh = () => setPublishers(getGobletPublishers());
    const unsubscribe = subscribeGobletPublishers(refresh);
    void hydrateHostGobletPublishers().catch(() => undefined);
    refresh();
    return unsubscribe;
  }, []);

  return (
    <>
      <Button variant="secondary" onClick={() => onDownload(artifact)}>Download</Button>
      {publishers.map((publisher) => (
        <Button
          key={publisher.id}
          variant="primary"
          disabled={publishingPublisherId !== null}
          onClick={() => onPublish(publisher, artifact)}
        >
          {publishingPublisherId === publisher.id ? 'Publishing...' : `Publish to ${publisher.label}`}
        </Button>
      ))}
      <Button variant="secondary" onClick={onClose}>Close</Button>
    </>
  );
};
