/// <reference lib="webworker" />
import type {
  ColorCycleCompositorMessage,
  ColorCycleCompositorResponse,
  ColorCycleCompositorCommandType,
} from './colorCycleCompositorTypes';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const postResponse = (response: ColorCycleCompositorResponse) => {
  ctx.postMessage(response);
};

const unsupportedCommand = (command: ColorCycleCompositorCommandType, requestId?: number) => {
  postResponse({
    type: 'error',
    requestId,
    message: `Unsupported color cycle compositor command: ${command}`
  });
};

ctx.addEventListener('message', (event: MessageEvent<ColorCycleCompositorMessage>) => {
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

export {};
