const ctx = self;

const postResponse = (response) => {
  ctx.postMessage(response);
};

const layers = new Map();

const normalizeVersion = (version) => (
  typeof version === 'number' && Number.isFinite(version)
    ? version
    : null
);

const unsupportedCommand = (command, requestId) => {
  postResponse({
    type: 'error',
    requestId,
    message: `Unsupported color cycle compositor command: ${command}`,
  });
};

ctx.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'ping': {
      postResponse({ type: 'pong', requestId: message.requestId });
      break;
    }
    case 'ensure-layer': {
      layers.set(message.layerId, {
        layerId: message.layerId,
        width: message.width,
        height: message.height,
        builtFromVersion: normalizeVersion(message.documentVersion),
      });
      postResponse({ type: 'ack', requestId: message.requestId, command: 'ensure-layer' });
      break;
    }
    case 'dispose-layer': {
      layers.delete(message.layerId);
      postResponse({ type: 'ack', requestId: message.requestId, command: 'dispose-layer' });
      break;
    }
    case 'apply-mask': {
      const layer = layers.get(message.layerId);
      if (layer) {
        layer.builtFromVersion = normalizeVersion(message.documentVersion);
      }
      postResponse({ type: 'ack', requestId: message.requestId, command: 'apply-mask' });
      break;
    }
    case 'frame-request': {
      postResponse({ type: 'frame', requestId: message.requestId, layers: [] });
      break;
    }
    case 'shutdown': {
      layers.clear();
      postResponse({ type: 'ack', requestId: message.requestId, command: 'shutdown' });
      break;
    }
    default: {
      unsupportedCommand(message.type, message.requestId);
      break;
    }
  }
});
