const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

const requireSafeRequestId = (value) => {
  const requestId = String(value ?? '');
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('A request ID using letters, numbers, dot, colon, underscore, or dash is required');
  }
  return requestId;
};

export const fetchVesselCollaborationJson = async (url, options) => {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(value.error ?? `Request failed (${response.status})`);
  }
  return { response, value };
};

export const createVesselCollaborationBridgeClient = (state) => {
  const headers = {
    Authorization: `Bearer ${state.token}`,
    'Content-Type': 'application/json',
  };

  const getResult = async (commandId) => {
    const pending = await fetchVesselCollaborationJson(
      `${state.url}/v1/results/${encodeURIComponent(commandId)}`,
      { headers },
    );
    return pending.response.status === 200
      ? { pending: false, result: pending.value }
      : { pending: true };
  };

  const getEvents = async (commandId, after = 0) => {
    const response = await fetchVesselCollaborationJson(
      `${state.url}/v1/events/${encodeURIComponent(commandId)}?after=${after}`,
      { headers },
    );
    return response.value;
  };

  const cancel = async (commandId) => {
    if (!COMMAND_ID_PATTERN.test(String(commandId ?? ''))) {
      throw new Error('Cancel requires a Vessel command UUID');
    }
    const response = await fetchVesselCollaborationJson(
      `${state.url}/v1/commands/${encodeURIComponent(commandId)}/cancel`,
      { method: 'POST', headers },
    );
    return response.value;
  };

  const enqueue = async (input, requestId) => {
    const command = { ...input };
    delete command.id;
    delete command.requestId;
    const safeRequestId = requireSafeRequestId(requestId);
    const queued = await fetchVesselCollaborationJson(`${state.url}/v1/commands`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': safeRequestId },
      body: JSON.stringify(command),
    });
    return {
      commandId: queued.value.id,
      requestId: safeRequestId,
      reused: Boolean(queued.value.reused),
    };
  };

  const waitForResult = async (
    commandId,
    timeoutMs = 120000,
    { onEvent } = {},
  ) => {
    const timeoutAt = timeoutMs === null ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
    let eventCursor = 0;
    while (Date.now() < timeoutAt) {
      const [pending, eventBatch] = await Promise.all([
        getResult(commandId),
        getEvents(commandId, eventCursor),
      ]);
      for (const event of eventBatch.events) await onEvent?.(event);
      eventCursor = eventBatch.next;
      if (!pending.pending) return pending.result;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const error = new Error(
      `Timed out waiting for Vessel command ${commandId}; result status is unknown`,
    );
    error.commandId = commandId;
    throw error;
  };

  return {
    headers,
    enqueue,
    cancel,
    getEvents,
    getResult,
    waitForResult,
    send: async (input, { timeoutMs = 120000, requestId, onAccepted, onEvent } = {}) => {
      const accepted = await enqueue(input, requestId ?? input.requestId);
      onAccepted?.(accepted);
      const result = await waitForResult(accepted.commandId, timeoutMs, { onEvent });
      return { accepted, result };
    },
  };
};
