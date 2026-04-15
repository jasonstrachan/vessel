import { NextResponse } from 'next/server';

type ClientRuntimePayload = {
  event?: 'crash' | 'heartbeat' | 'longtask' | 'lag';
  clientId?: string;
  type?: 'error' | 'unhandledrejection';
  message?: string;
  stack?: string | null;
  href?: string;
  userAgent?: string;
  breadcrumbs?: unknown[];
  filename?: string | null;
  lineno?: number | null;
  colno?: number | null;
  durationMs?: number | null;
  lagMs?: number | null;
  visibilityState?: string | null;
  ts?: number | null;
};

type ClientHeartbeatState = {
  lastSeenAt: number;
  lastHref: string | null;
};

const HEARTBEAT_GAP_MS = 15_000;
const clientHeartbeatState = new Map<string, ClientHeartbeatState>();

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asFiniteNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export async function POST(request: Request) {
  let payload: ClientRuntimePayload | null = null;

  try {
    payload = (await request.json()) as ClientRuntimePayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const event = payload?.event ?? 'crash';
  const clientId = asString(payload?.clientId) ?? 'unknown-client';
  const href = asString(payload?.href);
  const userAgent = asString(payload?.userAgent);
  const visibilityState = asString(payload?.visibilityState);
  const ts = asFiniteNumber(payload?.ts) ?? Date.now();

  if (event === 'heartbeat') {
    const now = Date.now();
    const previous = clientHeartbeatState.get(clientId);
    if (previous) {
      const gapMs = now - previous.lastSeenAt;
      if (gapMs > HEARTBEAT_GAP_MS) {
        console.warn('[client-runtime-gap]', {
          clientId,
          gapMs,
          href,
          previousHref: previous.lastHref,
          visibilityState,
          userAgent,
        });
      }
    } else {
      console.log('[client-runtime-heartbeat-start]', {
        clientId,
        href,
        visibilityState,
        userAgent,
      });
    }

    clientHeartbeatState.set(clientId, {
      lastSeenAt: now,
      lastHref: href,
    });

    return NextResponse.json({ ok: true });
  }

  if (event === 'longtask') {
    console.warn('[client-runtime-longtask]', {
      clientId,
      durationMs: asFiniteNumber(payload?.durationMs),
      href,
      visibilityState,
      ts,
    });
    return NextResponse.json({ ok: true });
  }

  if (event === 'lag') {
    console.warn('[client-runtime-lag]', {
      clientId,
      lagMs: asFiniteNumber(payload?.lagMs),
      href,
      visibilityState,
      ts,
    });
    return NextResponse.json({ ok: true });
  }

  const type = payload?.type === 'unhandledrejection' ? 'unhandledrejection' : 'error';
  const message = asString(payload?.message) ?? 'Unknown client runtime error';
  const stack = asString(payload?.stack);
  const filename = asString(payload?.filename);
  const lineno = asFiniteNumber(payload?.lineno);
  const colno = asFiniteNumber(payload?.colno);
  const breadcrumbs = Array.isArray(payload?.breadcrumbs) ? payload.breadcrumbs.slice(-20) : [];

  console.error('[client-runtime-error]', {
    clientId,
    type,
    message,
    href,
    filename,
    lineno,
    colno,
    userAgent,
    visibilityState,
    ts,
    stack,
    breadcrumbs,
  });

  return NextResponse.json({ ok: true });
}
