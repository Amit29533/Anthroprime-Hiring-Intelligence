import { getDocument as loadDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
// Vite emits local assets; parsing never downloads CVs or font maps from a CDN.
const assets = import.meta.glob(
  '/node_modules/pdfjs-dist/{standard_fonts,cmaps}/*.{pfb,ttf,bcmap}',
  { eager: true, query: '?url', import: 'default' },
);
class LocalPdfData {
  async fetch({ kind, filename }) {
    const directory =
      kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : null;
    const url = directory && assets[`/node_modules/pdfjs-dist/${directory}/${filename}`];
    if (!url) throw new Error('Unsupported PDF font asset.');
    const response = await fetch(url);
    if (!response.ok) throw new Error('PDF font asset could not be loaded.');
    return new Uint8Array(await response.arrayBuffer());
  }
}
export function getDocument(options) {
  return loadDocument({
    ...options,
    BinaryDataFactory: LocalPdfData,
    useWorkerFetch: false,
    cMapPacked: true,
  });
}
