require('@testing-library/jest-dom');
require('./tests/setup/canvasMock');
require('./tests/setup/webgpuMock');
require('./tests/setup/workerMock');

const { TextDecoder, TextEncoder } = require('util');

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}
