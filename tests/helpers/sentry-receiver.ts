import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';

export interface ReceivedEnvelope {
  path: string;
  header: Record<string, unknown>;
  items: { header: Record<string, unknown>; payload: Record<string, unknown> | string }[];
}

export interface SentryReceiver {
  /** A DSN pointing at this receiver, project 1. */
  dsn: string;
  envelopes: ReceivedEnvelope[];
  /** Error events, from envelope items of type `event`. */
  events(): Record<string, unknown>[];
  stop(): Promise<void>;
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  return request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
}

function parseJson(line: string): Record<string, unknown> | string {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
}

// Sentry envelopes are newline-separated: an envelope header, then pairs of
// item header and payload. BookIt's events have JSON payloads with no
// embedded newlines.
function parseEnvelope(path: string, text: string): ReceivedEnvelope {
  const lines = text.split('\n').filter((line) => line !== '');
  const header = parseJson(lines[0] ?? '{}');
  const items: ReceivedEnvelope['items'] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const itemHeader = parseJson(lines[i]!);
    items.push({
      header: typeof itemHeader === 'string' ? {} : itemHeader,
      payload: parseJson(lines[i + 1]!),
    });
  }
  return { path, header: typeof header === 'string' ? {} : header, items };
}

/** A local stand-in for fake-sentry that records every envelope it is sent. */
export async function startSentryReceiver(): Promise<SentryReceiver> {
  const envelopes: ReceivedEnvelope[] = [];
  const server = createServer((request, response) => {
    void body(request).then((raw) => {
      envelopes.push(parseEnvelope(request.url ?? '', raw.toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    dsn: `http://testkey@127.0.0.1:${port}/1`,
    envelopes,
    events: () =>
      envelopes.flatMap((e) =>
        e.items
          .filter((item) => item.header.type === 'event' && typeof item.payload !== 'string')
          .map((item) => item.payload as Record<string, unknown>),
      ),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
