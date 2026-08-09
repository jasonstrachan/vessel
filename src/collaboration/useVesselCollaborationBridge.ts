'use client';

import { useEffect, useRef } from 'react';
import { createVesselCollaborationExecutor, type VesselCollaborationRuntime } from './vesselCollaborationExecutor';
import { parseVesselCollaborationCommand } from './vesselCollaborationProtocol';
import {
  createVesselCollaborationRuntimeIdentity,
  type VesselCollaborationRuntimeIdentity,
} from './vesselCollaborationRuntimeIdentity';

interface BridgeConfig {
  url: string;
  token: string;
  clientId: string;
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
  const clientId = params.get('vesselCollabClient') ?? crypto.randomUUID();
  return { url: url.origin, token, clientId };
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
    const runtimeIdentityRef = {
      current: createVesselCollaborationRuntimeIdentity(),
    };
    const headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'X-Vessel-Collab-Client': config.clientId,
    };
    const execute = createVesselCollaborationExecutor(
      () => runtimeRef.current,
      {
        getRuntimeIdentity: () => runtimeIdentityRef.current,
        requireRuntimeFence: true,
        enforceGeometryPreflight: true,
      },
    );

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
          if (response.status === 409) {
            abortController.abort();
            return;
          }
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 250);
      }
    };

    const postEvent = async (
      commandId: string,
      eventId: string,
      event: unknown,
    ) => {
      while (!abortController.signal.aborted) {
        try {
          const response = await fetch(
            `${config.url}/v1/commands/${encodeURIComponent(commandId)}/events`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                commandId,
                eventId,
                event,
                runtime: runtimeIdentityRef.current,
              }),
              signal: abortController.signal,
            },
          );
          if (response.ok) return;
          if (response.status === 409) {
            abortController.abort();
            return;
          }
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 100);
      }
    };

    const readCancellation = async (commandId: string) => {
      const response = await fetch(
        `${config.url}/v1/commands/${encodeURIComponent(commandId)}/control`,
        { headers, signal: abortController.signal },
      );
      if (response.status === 409) {
        abortController.abort();
        return true;
      }
      if (!response.ok) return false;
      const control = await response.json() as { cancelRequested?: boolean };
      return control.cancelRequested === true;
    };

    const monitorCancellation = async (
      commandId: string,
      commandAbortController: AbortController,
      isActive: () => boolean,
    ) => {
      while (
        isActive() &&
        !commandAbortController.signal.aborted &&
        !abortController.signal.aborted
      ) {
        try {
          if (await readCancellation(commandId)) {
            commandAbortController.abort();
            return;
          }
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 250);
      }
    };

    const run = async () => {
      while (!abortController.signal.aborted) {
        try {
          const claim = await fetch(`${config.url}/v1/clients/claim`, {
            method: 'POST',
            headers,
            body: JSON.stringify(runtimeIdentityRef.current),
            signal: abortController.signal,
          });
          if (claim.ok) {
            const claimed = await claim.json() as { leaseEpoch?: number };
            if (!Number.isInteger(claimed.leaseEpoch)) {
              throw new Error('Bridge claim did not return a lease epoch');
            }
            runtimeIdentityRef.current = {
              ...runtimeIdentityRef.current,
              leaseEpoch: claimed.leaseEpoch as number,
            } satisfies VesselCollaborationRuntimeIdentity;
            break;
          }
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 250);
      }

      while (!abortController.signal.aborted) {
        try {
          const response = await fetch(`${config.url}/v1/commands/next?wait=25000`, {
            headers,
            signal: abortController.signal,
          });
          if (response.status === 204) continue;
          if (response.status === 409) return;
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
            if (command.action === 'artwork-job') {
              const commandAbortController = new AbortController();
              const abortCommand = () => commandAbortController.abort();
              abortController.signal.addEventListener('abort', abortCommand, { once: true });
              let active = true;
              let eventIndex = 0;
              let eventPostChain = Promise.resolve();
              try {
                if (await readCancellation(commandId)) {
                  commandAbortController.abort();
                }
              } catch {
                if (abortController.signal.aborted) return;
              }
              if (!commandAbortController.signal.aborted) {
                void monitorCancellation(
                  commandId,
                  commandAbortController,
                  () => active,
                );
              }
              try {
                result = await execute(command, {
                  signal: commandAbortController.signal,
                  onEvent: (event) => {
                    eventPostChain = eventPostChain.then(() => postEvent(
                      commandId,
                      `${commandId}:${eventIndex += 1}`,
                      event,
                    ));
                  },
                });
                await eventPostChain;
              } finally {
                active = false;
                abortController.signal.removeEventListener('abort', abortCommand);
              }
            } else {
              result = await execute(command);
            }
          } catch (error) {
            result = {
              ok: false,
              commandId,
              action: typeof rawCommand.action === 'string' ? rawCommand.action : 'invalid',
              revision: -1,
              runtime: runtimeIdentityRef.current,
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
