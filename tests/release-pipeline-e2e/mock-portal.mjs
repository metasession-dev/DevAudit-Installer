import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const [portFile, requestLog] = process.argv.slice(2);
if (!portFile || !requestLog) throw new Error('port file and request log are required');

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    appendFileSync(
      requestLog,
      `${JSON.stringify({ method: request.method, url: request.url, body })}\n`,
    );

    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url?.startsWith('/api/ci/releases/resolve?')) {
      response.end(
        JSON.stringify({
          latest: {
            id: '11111111-1111-4111-8111-111111111111',
            version: 'REQ-777',
            status: 'released',
          },
        }),
      );
      return;
    }
    if (request.method === 'POST' && request.url?.includes('/cycles/')) {
      response.end(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222' }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('unexpected server address');
  writeFileSync(portFile, `${address.port}\n`);
});
