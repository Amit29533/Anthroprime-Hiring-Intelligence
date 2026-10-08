import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
const magic = Buffer.from('ANTHRO2\0');
export function recoveryKey(value = process.env.RECOVERY_KEY_HEX) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))
    throw Error('Set a server-only 256-bit recovery key');
  return Buffer.from(value, 'hex');
}
export async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const b of createReadStream(path)) hash.update(b);
  return hash.digest('hex');
}
export async function encryptStream(source, path, key, aad, { maxBytes = 10737418240 } = {}) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  let bytes = 0;
  const limit = new Transform({
    transform(chunk, _, done) {
      bytes += chunk.length;
      done(bytes > maxBytes ? Error('Backup input bound exceeded') : null, chunk);
    },
  });
  const file = await open(path, 'wx', 0o600);
  try {
    await file.write(Buffer.concat([magic, iv]));
    await file.close();
    await pipeline(source, limit, cipher, createWriteStream(path, { flags: 'a', mode: 0o600 }));
    const out = await open(path, 'a');
    try {
      await out.write(cipher.getAuthTag());
    } finally {
      await out.close();
    }
    return { bytes, digest: await digestFile(path) };
  } catch (e) {
    await file.close().catch(() => {});
    throw e;
  }
}
export async function decryptFile(source, destination, key, aad) {
  const info = await stat(source);
  if (!info.isFile() || info.size < 36 || info.size > 10737418276)
    throw Error('Invalid encrypted backup size');
  const file = await open(source, 'r');
  const header = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  try {
    await file.read(header, 0, 20, 0);
    await file.read(tag, 0, 16, info.size - 16);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, 8).equals(magic)) throw Error('Unsupported encrypted backup');
  const cipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(tag);
  await pipeline(
    info.size === 36
      ? Readable.from([])
      : createReadStream(source, { start: 20, end: info.size - 17 }),
    cipher,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  );
}
