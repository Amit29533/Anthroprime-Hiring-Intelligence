import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('public/linkedin-local-extractor-manifest.json', root), 'utf8'),
);
const hash = (path, normalize = false) => {
  const content = readFileSync(new URL(path, root));
  return createHash('sha256')
    .update(normalize ? content.toString('utf8').replaceAll('\r\n', '\n') : content)
    .digest('hex');
};
if (
  hash('public/linkedin-local-extractor.zip') !== manifest.archiveSha256 ||
  Object.entries(manifest.files).some(([path, expected]) => hash(path, true) !== expected)
) {
  throw new Error(
    'LinkedIn download is stale. Run python tools/package_linkedin_extractor.py and commit the refreshed public archive and manifest.',
  );
}
console.log('LinkedIn local download matches reviewed sources.');
