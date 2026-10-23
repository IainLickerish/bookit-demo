import { createServer, request as upstreamRequest } from 'node:http';

// Fixed local destinations, never a forward proxy. Only this small HTTP ingress
// joins the host-facing bridge; BookIt, Postgres and SMTP stay on the internal
// clinic network. Request bodies, cookies and credentials are never logged.
for (const target of [
  { listen: 3000, host: 'bookit', port: 3000 },
  { listen: 8025, host: 'mailpit', port: 8025 },
]) {
  createServer((request, response) => {
    const upstream = upstreamRequest(
      {
        hostname: target.host,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
        timeout: 30_000,
      },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end('Local clinic unavailable');
    });
    request.on('aborted', () => upstream.destroy());
    request.on('error', () => upstream.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  }).listen(target.listen, '0.0.0.0');
}
