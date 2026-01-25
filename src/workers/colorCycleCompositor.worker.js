const ctx = self;

const postResponse = (response) => {
  ctx.postMessage(response);
};

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
    default: {
      unsupportedCommand(message.type, message.requestId);
      break;
    }
  }
});
