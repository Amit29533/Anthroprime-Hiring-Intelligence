import net from 'node:net';

// clamd's protocol has no authentication. Connect only to the private Docker network.
export function clamdCommand(
  command,
  bytes,
  {
    host = process.env.CLAMD_HOST || 'clamav',
    port = 3310,
    timeoutMs = command === 'VERSION' ? 5000 : 30000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = Buffer.alloc(0);
    const timer = setTimeout(() => stop(new Error('Scanner timed out')), timeoutMs);
    function stop(error, value) {
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(value);
    }
    socket.on('error', () => stop(new Error('Scanner unavailable')));
    socket.on('end', () => stop(new Error('Incomplete scanner response')));
    socket.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 1024) return stop(new Error('Invalid scanner response'));
      const end = response.indexOf(0);
      if (end !== -1) stop(null, response.subarray(0, end).toString('utf8'));
    });
    socket.on('connect', () => {
      socket.write(`z${command}\0`);
      if (!bytes) return;
      let offset = 0;
      function send() {
        while (offset < bytes.length) {
          const part = bytes.subarray(offset, offset + 65536);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(part.length);
          offset += part.length;
          if (!socket.write(Buffer.concat([header, part]))) {
            socket.once('drain', send);
            return;
          }
        }
        socket.write(Buffer.alloc(4));
      }
      send();
    });
  });
}
export function verifyDefinitions(version, now = Date.now()) {
  const match = /^ClamAV ([^/\s]+)\/(\d+)\/(.+)$/.exec(version);
  const date = match ? Date.parse(`${match[3]} GMT`) : NaN;
  if (!Number.isFinite(date) || date > now + 300000 || now - date > 48 * 3600000)
    throw new Error('Scanner definitions missing or stale');
  return version;
}
export async function scanPrivateBytes(bytes, { command = clamdCommand, now = Date.now() } = {}) {
  if (!bytes.length || bytes.length > 5242880) throw new Error('Invalid scan size');
  const engine = verifyDefinitions(await command('VERSION'), now);
  const verdict = await command('INSTREAM', bytes);
  // Engine changes while scanning make provenance ambiguous; retry with the current definitions.
  if (verifyDefinitions(await command('VERSION'), now) !== engine)
    throw new Error('Scanner definitions changed');
  if (verdict === 'stream: OK') return { status: 'clean', engine };
  if (/^stream: .+ FOUND$/.test(verdict)) return { status: 'infected', engine };
  throw new Error('Scanner did not complete');
}
