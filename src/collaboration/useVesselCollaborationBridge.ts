'use client';

import { useEffect, useRef } from 'react';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import {
  waitForAllPendingColorCycleSaves,
  waitForFinalizeQueueIdle,
} from '@/stores/pendingColorCycleSaves';
import { createVesselCollaborationExecutor, type VesselCollaborationRuntime } from './vesselCollaborationExecutor';
import { parseVesselCollaborationCommand } from './vesselCollaborationProtocol';
import {
  createVesselCollaborationRuntimeIdentity,
  type VesselCollaborationRuntimeIdentity,
} from './vesselCollaborationRuntimeIdentity';
import {
  subscribeVesselMultiplayerHumanGestures,
  type VesselMultiplayerHumanGestureEvent,
} from './vesselMultiplayerHumanInput';
import { captureVesselMultiplayerCanvasFrame } from './vesselMultiplayerCanvasStream';
import {
  getVesselMultiplayerSnapshot,
  updateVesselMultiplayerBridgeHealth,
  validateVesselMultiplayerSession,
  type VesselMultiplayerAiState,
} from './vesselMultiplayerSession';
import { getAppStoreState } from '@/stores/appStoreAccess';

const MULTIPLAYER_OBSERVATION_MAX_SIZE = 384;

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

const waitForCanonicalCollaborationIdle = async () => {
  await waitForFinalizeQueueIdle();
  await waitForAllPendingColorCycleSaves();
  await waitForPendingHistoryCommits();
};

export const useVesselCollaborationBridge = (runtime: VesselCollaborationRuntime) => {
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    const config = readBridgeConfig();
    if (!config) return;

    const abortController = new AbortController();
    updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
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
        waitForCanonicalIdle: waitForCanonicalCollaborationIdle,
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
          if (response.status === 401 || response.status === 403) {
            abortController.abort();
            return;
          }
          if (response.status === 409) {
            updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
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
          if (response.status === 401 || response.status === 403) {
            abortController.abort();
            return;
          }
          if (response.status === 409) {
            updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
          }
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 100);
      }
    };

    const postRuntimeEvent = async (event: unknown) => {
      while (!abortController.signal.aborted) {
        try {
          const response = await fetch(`${config.url}/v1/runtime-events`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              event,
              runtime: runtimeIdentityRef.current,
            }),
            signal: abortController.signal,
          });
          if (response.ok) return;
          if (response.status === 400) return;
          if (response.status === 401 || response.status === 403) {
            abortController.abort();
            return;
          }
          if (response.status === 409) {
            updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
          }
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 100);
      }
    };

    const postMultiplayerFrame = async (
      frame: Awaited<ReturnType<typeof captureVesselMultiplayerCanvasFrame>>,
    ) => {
      try {
        const target = new URL(`${config.url}/v1/multiplayer-frame`);
        const metadata = {
          frameId: frame.frameId,
          sessionId: frame.sessionId,
          projectId: frame.projectId,
          projectRevision: frame.projectRevision,
          aiLayerType: frame.aiLayerType,
          capturedAt: frame.capturedAt,
          width: frame.width,
          height: frame.height,
          sourceWidth: frame.sourceWidth,
          sourceHeight: frame.sourceHeight,
          mimeType: frame.mimeType,
          gestureId: frame.gestureId,
          gesturePhase: frame.gesturePhase,
          gesturePointCount: frame.gesturePointCount,
          runtime: runtimeIdentityRef.current,
        };
        target.searchParams.set('metadata', JSON.stringify(metadata));
        const response = await fetch(target, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': frame.mimeType },
          body: frame.blob,
          signal: abortController.signal,
        });
        if (response.status === 401 || response.status === 403) {
          abortController.abort();
          return;
        }
        if (response.status === 409) {
          updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
          return;
        }
        if (response.ok) {
          updateVesselMultiplayerBridgeHealth({
            bridgeStatus: 'connected',
            lastObservationAt: frame.capturedAt,
          });
        }
      } catch {
        // Frames are replaceable; the next gesture update supplies a fresher one.
      }
    };

    const readCancellation = async (commandId: string) => {
      const response = await fetch(
        `${config.url}/v1/commands/${encodeURIComponent(commandId)}/control`,
        { headers, signal: abortController.signal },
      );
      if (response.status === 401 || response.status === 403) {
        abortController.abort();
        return true;
      }
      if (response.status === 409) {
        updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
        return false;
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

    let runtimeClaimPending: Promise<boolean> | null = null;
    const claimBridgeRuntime = () => {
      if (runtimeClaimPending) return runtimeClaimPending;
      runtimeClaimPending = (async () => {
        const claim = await fetch(`${config.url}/v1/clients/claim`, {
            method: 'POST',
            headers,
            body: JSON.stringify(runtimeIdentityRef.current),
            signal: abortController.signal,
        });
        if (!claim.ok) return false;
        const claimed = await claim.json() as {
          leaseEpoch?: number;
          multiplayerAi?: {
            state?: VesselMultiplayerAiState;
            model?: string;
            lastError?: string | null;
          };
        };
        if (!Number.isInteger(claimed.leaseEpoch)) {
          throw new Error('Bridge claim did not return a lease epoch');
        }
        runtimeIdentityRef.current = {
          ...runtimeIdentityRef.current,
          leaseEpoch: claimed.leaseEpoch as number,
        } satisfies VesselCollaborationRuntimeIdentity;
        updateVesselMultiplayerBridgeHealth({
          bridgeStatus: 'connected',
          aiState: claimed.multiplayerAi?.state ?? 'unknown',
          aiModel: claimed.multiplayerAi?.model ?? null,
          error: claimed.multiplayerAi?.lastError ?? null,
        });
        return true;
      })().finally(() => {
        runtimeClaimPending = null;
      });
      return runtimeClaimPending;
    };

    const run = async () => {
      while (!abortController.signal.aborted) {
        try {
          if (await claimBridgeRuntime()) break;
        } catch {
          if (abortController.signal.aborted) return;
        }
        await waitForRetry(abortController.signal, 250);
      }

      if (abortController.signal.aborted) return;

      const runtimeEventQueue: VesselMultiplayerHumanGestureEvent[] = [];
      let runtimeEventPump: Promise<void> | null = null;
      let frameCapturePending = false;
      let observationTimer: number | null = null;
      let queuedObservation: VesselMultiplayerHumanGestureEvent | null | undefined;
      let committedEventChain = Promise.resolve();
      const canonicalSourceCanvas = document.createElement('canvas');
      const streamMultiplayerFrame = async (
        event: VesselMultiplayerHumanGestureEvent | null,
      ) => {
        if (frameCapturePending) {
          queuedObservation = event;
          return;
        }
        if (abortController.signal.aborted) return;
        try {
          validateVesselMultiplayerSession();
        } catch {
          return;
        }
        const multiplayer = getVesselMultiplayerSnapshot();
        if (multiplayer.status !== 'active' || !multiplayer.sessionId) return;
        const aiLayer = getAppStoreState().layers.find(
          (layer) => layer.id === multiplayer.aiLayerId,
        );
        if (aiLayer?.layerType !== 'normal' && aiLayer?.layerType !== 'color-cycle') return;
        const source = runtimeRef.current.createMultiplayerCanvasSource?.(
          canonicalSourceCanvas,
          { tool: event?.tool ?? null },
        );
        if (!source || source.projectId !== multiplayer.projectId) return;
        frameCapturePending = true;
        try {
          const frame = await captureVesselMultiplayerCanvasFrame({
            canvas: source.canvas,
            projectId: source.projectId,
            projectRevision: source.projectRevision,
            aiLayerType: aiLayer.layerType,
            sessionId: multiplayer.sessionId,
            gestureId: event?.gestureId ?? null,
            gesturePhase: event?.phase ?? 'idle',
            gesturePointCount: event?.pointCount ?? 0,
            maxSize: MULTIPLAYER_OBSERVATION_MAX_SIZE,
          });
          const current = getVesselMultiplayerSnapshot();
          if (current.status === 'active' && current.sessionId === frame.sessionId) {
            await postMultiplayerFrame(frame);
          }
        } catch {
          // Continuous observation must never interrupt the local drawing path.
        } finally {
          frameCapturePending = false;
          if (queuedObservation !== undefined) {
            const next = queuedObservation;
            queuedObservation = undefined;
            scheduleMultiplayerFrame(next, true);
          }
        }
      };
      function scheduleMultiplayerFrame(
        event: VesselMultiplayerHumanGestureEvent | null,
        immediate = false,
      ) {
        queuedObservation = event;
        if (observationTimer !== null || abortController.signal.aborted) return;
        observationTimer = window.setTimeout(() => {
          observationTimer = null;
          const next = queuedObservation ?? null;
          queuedObservation = undefined;
          void streamMultiplayerFrame(next);
        }, immediate ? 0 : 120);
      }
      const pumpRuntimeEvents = () => {
        if (runtimeEventPump) return;
        runtimeEventPump = (async () => {
          while (runtimeEventQueue.length > 0 && !abortController.signal.aborted) {
            const event = runtimeEventQueue.shift();
            if (event) await postRuntimeEvent(event);
          }
        })().finally(() => {
          runtimeEventPump = null;
          if (runtimeEventQueue.length > 0 && !abortController.signal.aborted) {
            pumpRuntimeEvents();
          }
        });
      };
      const unsubscribeHumanGestures = subscribeVesselMultiplayerHumanGestures((event) => {
        if (event.phase === 'end') {
          committedEventChain = committedEventChain.then(async () => {
            await waitForCanonicalCollaborationIdle();
            const state = getAppStoreState();
            const multiplayer = validateVesselMultiplayerSession();
            if (
              multiplayer.status !== 'active' ||
              multiplayer.sessionId !== event.sessionId ||
              state.project?.id !== event.projectId
            ) return;
            const committedEvent: VesselMultiplayerHumanGestureEvent = {
              ...event,
              projectRevision: state.autosave.dirtyRevision,
              committed: true,
              committedAt: Date.now(),
            };
            runtimeEventQueue.push(committedEvent);
            pumpRuntimeEvents();
            scheduleMultiplayerFrame(committedEvent, true);
          }).catch(() => undefined);
          return;
        }
        if (event.phase === 'move') {
          const pendingMoveIndex = runtimeEventQueue.findLastIndex((candidate) => (
            candidate.phase === 'move' && candidate.gestureId === event.gestureId
          ));
          if (pendingMoveIndex >= 0) runtimeEventQueue.splice(pendingMoveIndex, 1);
        }
        if (runtimeEventQueue.length >= 128) {
          const droppableMoveIndex = runtimeEventQueue.findIndex((candidate) => (
            candidate.phase === 'move'
          ));
          runtimeEventQueue.splice(droppableMoveIndex >= 0 ? droppableMoveIndex : 0, 1);
        }
        runtimeEventQueue.push(event);
        pumpRuntimeEvents();
        scheduleMultiplayerFrame(event, event.phase === 'start' || event.phase === 'cancel');
      });
      let observedSessionId: string | null = null;
      let healthRefreshPending = false;
      const refreshBridgeHealth = async () => {
        if (healthRefreshPending || abortController.signal.aborted) return;
        healthRefreshPending = true;
        try {
          const response = await fetch(`${config.url}/v1/health`, {
            headers,
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error(`Bridge health failed (${response.status})`);
          const health = await response.json() as {
            clientReady?: boolean;
            multiplayerAi?: {
              state?: VesselMultiplayerAiState;
              model?: string;
              lastError?: string | null;
            };
          };
          if (health.clientReady === false) {
            updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
            if (!await claimBridgeRuntime()) {
              throw new Error('Bridge runtime claim was rejected');
            }
          }
          updateVesselMultiplayerBridgeHealth({
            bridgeStatus: 'connected',
            aiState: health.multiplayerAi?.state ?? 'unknown',
            aiModel: health.multiplayerAi?.model ?? null,
            error: health.multiplayerAi?.lastError ?? null,
          });
          let multiplayer: ReturnType<typeof getVesselMultiplayerSnapshot>;
          try {
            multiplayer = validateVesselMultiplayerSession();
          } catch {
            return;
          }
          if (
            multiplayer.status === 'active' &&
            multiplayer.sessionId &&
            multiplayer.sessionId !== observedSessionId
          ) {
            observedSessionId = multiplayer.sessionId;
            scheduleMultiplayerFrame(null, true);
          }
        } catch (error) {
          if (!abortController.signal.aborted) {
            updateVesselMultiplayerBridgeHealth({
              bridgeStatus: 'connecting',
              error: error instanceof Error ? error.message : 'Bridge health is unavailable',
            });
          }
        } finally {
          healthRefreshPending = false;
        }
      };
      const healthInterval = window.setInterval(() => void refreshBridgeHealth(), 500);
      void refreshBridgeHealth();

      try {
        while (!abortController.signal.aborted) {
          try {
            const response = await fetch(`${config.url}/v1/commands/next?wait=25000`, {
              headers,
              signal: abortController.signal,
            });
            if (response.status === 204) continue;
            if (response.status === 409) {
              updateVesselMultiplayerBridgeHealth({ bridgeStatus: 'connecting', error: null });
              if (!await claimBridgeRuntime()) {
                await waitForRetry(abortController.signal, 250);
              }
              continue;
            }
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
              if (command.action === 'artwork-job' || command.action === 'multiplayer-gesture') {
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
      } finally {
        window.clearInterval(healthInterval);
        if (observationTimer !== null) window.clearTimeout(observationTimer);
        unsubscribeHumanGestures();
        await committedEventChain;
        await runtimeEventPump;
        runtimeEventQueue.length = 0;
        updateVesselMultiplayerBridgeHealth({
          bridgeStatus: 'disconnected',
          aiState: 'unknown',
          error: abortController.signal.aborted ? null : 'Collaboration bridge disconnected',
        });
      }
    };

    void run();
    return () => abortController.abort();
  }, []);
};
