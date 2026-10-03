export const PDF_LIMITS = { pages: 50, characters: 40000, timeoutMs: 20000 };

// Preserve PDF line boundaries for the CV draft parser, including Unicode text.
export function textFromItems(items) {
  let text = '',
    lastY;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 3 && !text.endsWith('\n'))
      text += '\n';
    text += item.str + (item.hasEOL ? '\n' : ' ');
    lastY = y;
  }
  return text.trim();
}

// The caller retains the original bytes for hashing and private storage.
export async function extractPdf(
  buffer,
  { loadEngine = () => import('./pdfEngine.js'), limits = PDF_LIMITS } = {},
) {
  let task,
    timer,
    expired = false;
  const work = async () => {
    const { getDocument } = await loadEngine();
    if (expired) throw new Error('PDF extraction timed out.');
    task = getDocument({
      data: new Uint8Array(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)),
      isEvalSupported: false,
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: false,
      isImageDecoderSupported: false,
    });
    const pdf = await task.promise;
    if (pdf.numPages > limits.pages)
      return {
        text: '',
        status: 'manual',
        warning: `PDF exceeds the ${limits.pages}-page parsing limit. Upload a shorter CV or enter the candidate details manually.`,
      };
    const pages = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = textFromItems(content.items);
      length += text.length + 1;
      page.cleanup();
      if (length > limits.characters)
        return {
          text: '',
          status: 'manual',
          warning: `PDF exceeds the ${limits.characters.toLocaleString()}-character parsing limit. Enter candidate details manually.`,
        };
      pages.push(text);
    }
    const text = pages.join('\n').trim();
    return text
      ? { text, status: 'parsed', warning: '' }
      : {
          text: '',
          status: 'manual',
          warning:
            'No readable PDF text found. This may be a scanned CV; upload a text-based PDF, DOCX or TXT, or enter candidate details manually. OCR is not available yet.',
        };
  };
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('PDF extraction timed out.'));
        }, limits.timeoutMs);
      }),
    ]);
  } catch (error) {
    const warning =
      error.name === 'PasswordException'
        ? 'This PDF is password protected. Upload an unlocked copy or enter candidate details manually.'
        : 'PDF text could not be read. Upload a valid text-based PDF or enter candidate details manually.';
    return {
      text: '',
      status: 'manual',
      warning: expired
        ? 'PDF extraction timed out. Try a smaller file or enter candidate details manually.'
        : warning,
    };
  } finally {
    clearTimeout(timer);
    if (task) await task.destroy().catch(() => {});
  }
}
