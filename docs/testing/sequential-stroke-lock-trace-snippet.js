// Paste this in DevTools Console after reproducing the issue.
// It returns only the most relevant stroke/sequential events.
window.__dumpStrokeLockTrace?.(1200)
  ?.filter(
    (e) =>
      e.event.startsWith('sequential.') ||
      e.event.startsWith('stroke.start.') ||
      e.event.startsWith('pointer.up.stroke.finalize')
  );
