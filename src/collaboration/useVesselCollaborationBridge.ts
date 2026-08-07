'use client';

import { useEffect, useRef } from 'react';
import { createVesselCollaborationExecutor, type VesselCollaborationRuntime } from './vesselCollaborationExecutor';
import { parseVesselCollaborationCommand } from './vesselCollaborationProtocol';

interface BridgeConfig {
  url: string;
  token: string;
}

const readBridgeConfig = (): BridgeConfig | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const rawUrl = params.get('vesselCollabUrl');
  const token = params.get('vesselCollabToken');
  if (!rawUrl || !token) return null;

  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) {
    return null;
  }
  return { url: url.origin, token };
};

const waitForRetry = (signal: AbortSignal, milliseconds: number) =>
  new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });

export const useVesselCollaborationBridge = (runtime: VesselCollaborationRuntime) => {
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    const config = readBridgeConfig();
    if (!config) return;

    const abortController = new AbortController();
    const headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    };
    const execute = createVesselCollaborationExecutor(() => runtimeRef.current);

    const postResult = async (commandId: string, result: unknown) => {
      while (!abortController.signal.aborted) {
        try {
          const response = await fetch(
            `${config.url}/v1/commands/${encodeURIComponent(commandId)}/result`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify(result),
              signal: abortController.signal,
            },
          );
          if (response.ok) return;
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 250);
      }
    };

    const run = async () => {
      while (!abortController.signal.aborted) {
        try {
          const response = await fetch(`${config.url}/v1/commands/next?wait=25000`, {
            headers,
            signal: abortController.signal,
          });
          if (response.status === 204) continue;
          if (!response.ok) {
            throw new Error(`Bridge command poll failed (${response.status})`);
          }

          const incoming = await response.json() as unknown;
          const rawCommand = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
            ? incoming as Record<string, unknown>
            : {};
          const commandId = typeof rawCommand.id === 'string' ? rawCommand.id : 'invalid-command';
          let result: unknown;
          try {
            const command = parseVesselCollaborationCommand(incoming);
            result = await execute(command);
          } catch (error) {
            result = {
              ok: false,
              commandId,
              action: typeof rawCommand.action === 'string' ? rawCommand.action : 'invalid',
              revision: -1,
              error: error instanceof Error ? error.message : 'Invalid collaboration command',
            };
          }
          await postResult(commandId, result);
        } catch {
          if (!abortController.signal.aborted) {
            await waitForRetry(abortController.signal, 500);
          }
        }
      }
    };

    void run();
    return () => abortController.abort();
  }, []);
};
