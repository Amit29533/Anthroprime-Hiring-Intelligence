import assert from 'node:assert/strict';
import { scanPrivateBytes } from './clamd.js';
// Harmless standardized antivirus test string, held in memory only.
const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
try {
  assert.equal(
    (await scanPrivateBytes(Buffer.from('Anthroprime scanner smoke check'))).status,
    'clean',
  );
  assert.equal((await scanPrivateBytes(eicar)).status, 'infected');
  console.log('PASS: fresh definitions, clean text and EICAR blocking.');
} catch {
  console.error('FAIL: scanner acceptance incomplete. Keep durable CV imports disabled.');
  process.exitCode = 1;
}
