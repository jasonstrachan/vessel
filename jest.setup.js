require('@testing-library/jest-dom');
require('./tests/setup/canvasMock');
require('./tests/setup/webgpuMock');
require('./tests/setup/workerMock');

const { TextDecoder, TextEncoder } = require('util');
const { MessageChannel, receiveMessageOnPort } = require('worker_threads');

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (value, options = {}) => {
    const { port1, port2 } = new MessageChannel();
    try {
      port1.postMessage(value, options.transfer ?? []);
      return receiveMessageOnPort(port2).message;
    } finally {
      port1.close();
      port2.close();
    }
  };
}
