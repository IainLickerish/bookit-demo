import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';

// Local protocol receiver used only in the Compose test override. Nothing is
// forwarded or logged. The clinic network has no Internet egress.
const events = [];
createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/events') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(events));
      return;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 1_000_000) throw new Error('Envelope too large');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    const decoded =
      request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw, { maxOutputLength: 2_000_000 }) : raw;
    const lines = decoded.toString('utf8').split('\n').filter(Boolean);
    for (let index = 1; index + 1 < lines.length; index += 2) {
      if (JSON.parse(lines[index]).type === 'event') events.push(JSON.parse(lines[index + 1]));
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  } catch {
    response.writeHead(400);
    response.end('Invalid envelope');
  }
}).listen(8080, '0.0.0.0');
