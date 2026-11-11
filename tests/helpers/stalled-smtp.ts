import type { AddressInfo, Socket } from 'node:net';
import { SMTPServer } from 'smtp-server';

/** A real local SMTP connection which never greets or acknowledges delivery. */
export async function startStalledSmtp(stage: 'greeting' | 'delivery') {
  let onStalled!: () => void;
  let onDisconnected!: () => void;
  const stalled = new Promise<void>((resolve) => {
    onStalled = resolve;
  });
  const disconnected = new Promise<void>((resolve) => {
    onDisconnected = resolve;
  });
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onConnect(_session, callback) {
      connections++;
      if (stage === 'greeting') onStalled();
      else callback();
    },
    onData(stream) {
      stream.resume();
      // Deliberately withhold the final acknowledgement, even though the
      // message has arrived. Delivery is uncertain and must not be retried.
      stream.on('end', onStalled);
    },
    onClose() {
      onDisconnected();
    },
  });
  server.server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.server.address() as AddressInfo;
  return {
    url: `smtp://127.0.0.1:${port}`,
    stalled,
    disconnected,
    get connections() {
      return connections;
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
