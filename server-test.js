const { createServer } = require('http');

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Server working!\n');
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Test server running on http://0.0.0.0:3000');
});