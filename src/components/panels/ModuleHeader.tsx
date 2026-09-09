import React from 'react';
import { ChevronRight } from 'lucide-react';

export function ModuleHeader({ title, headingId, expanded, onToggle, status, statusLabel }: {
  title: string;
  headingId?: string;
  expanded: boolean;
  onToggle: () => void;
  status?: React.ReactNode;
  statusLabel?: string;
}) {
  const statusId = React.useId();
  return <button type="button" aria-label={title} aria-expanded={expanded} aria-describedby={status ? statusId : undefined} onClick={onToggle}
    className="flex h-7 w-full items-center gap-2 bg-transparent text-left text-xs text-[#F1F1F6]">
    <span id={headingId} className="min-w-0 flex-1 font-medium">{title}</span>
    {status && <>
      <span aria-hidden className="text-[10px] font-normal text-[#999]">{status}</span>
      <span id={statusId} className="sr-only" aria-live={statusLabel ? 'polite' : undefined}>{statusLabel ?? status}</span>
    </>}
    <ChevronRight aria-hidden className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
  </button>;
}
