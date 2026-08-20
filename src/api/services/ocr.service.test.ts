import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Pinned rather than read from the developer's `.env`, so the page cap and the
// key check below mean the same thing on every machine.
vi.mock('~/config/enviroment', () => ({
  env: {
    GEMINI_API_KEY: 'test-key',
    OCR_REQUEST_TIMEOUT_MS: '300000',
    MODEL_MAX_RETRIES: '0',
    OCR_MAX_TABLE_PAGES: '3'
  }
}));

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAIError extends Error {}
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return { generateContent: gemini.generateContent };
      }
    },
    GoogleGenerativeAIError,
    GoogleGenerativeAIAbortError: class extends GoogleGenerativeAIError {},
    GoogleGenerativeAIFetchError: class extends GoogleGenerativeAIError {},
    GoogleGenerativeAIRequestInputError: class extends GoogleGenerativeAIError {},
    GoogleGenerativeAIResponseError: class extends GoogleGenerativeAIError {}
  };
});

import { runOcrOnPdfPages } from '~/api/services/ocr.service';

// Every page carries a token naming itself, so the payload can be read back to
// prove which pages were actually sent rather than merely asked about.
const buildNumberedPdf = async (pageCount: number): Promise<Buffer> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`MARKER-PAGE-${i}-END`, {
      x: 72,
      y: 700,
      size: 24,
      font,
      color: rgb(0, 0, 0)
    });
  }
  return Buffer.from(await doc.save());
};

// The base64 payload handed to the model, decoded back into a PDF.
const sentPdf = (): Buffer => {
  const parts = gemini.generateContent.mock.calls[0][0];
  return Buffer.from(parts[0].inlineData.data, 'base64');
};

const textOf = async (buffer: Buffer): Promise<string> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += (content.items as { str: string }[]).map((it) => it.str).join('');
  }
  await task.destroy();
  return text;
};

const reply = (text: string) => ({ response: { text: () => text } });

describe('runOcrOnPdfPages', () => {
  beforeEach(() => {
    gemini.generateContent.mockReset();
  });

  it('sends only the requested pages, not the whole document', async () => {
    const buffer = await buildNumberedPdf(40);
    gemini.generateContent.mockResolvedValue(
      reply('[page 1]\nfirst\n\n[page 2]\nsecond')
    );

    await runOcrOnPdfPages(buffer, [7, 22]);

    const payload = sentPdf();
    expect((await PDFDocument.load(payload)).getPageCount()).toBe(2);

    const text = await textOf(payload);
    expect(text).toContain('MARKER-PAGE-7-END');
    expect(text).toContain('MARKER-PAGE-22-END');
    expect(text).not.toContain('MARKER-PAGE-1-END');
    expect(text).not.toContain('MARKER-PAGE-40-END');
    expect(payload.length).toBeLessThan(buffer.length);
  }, 60000);

  it('maps positions in the extract back to original page numbers', async () => {
    const buffer = await buildNumberedPdf(40);
    gemini.generateContent.mockResolvedValue(
      reply('[page 1]\ntable from seven\n\n[page 2]\ntable from twenty-two')
    );

    const result = await runOcrOnPdfPages(buffer, [7, 22]);

    expect(result).toEqual({
      7: 'table from seven',
      22: 'table from twenty-two'
    });
  }, 60000);

  it('drops a marker outside the extract rather than overwriting a page', async () => {
    const buffer = await buildNumberedPdf(40);
    gemini.generateContent.mockResolvedValue(
      reply('[page 1]\nreal\n\n[page 9]\ninvented')
    );

    const result = await runOcrOnPdfPages(buffer, [7, 22]);

    expect(result).toEqual({ 7: 'real' });
  }, 60000);

  it('drops an empty page so the local text is kept', async () => {
    const buffer = await buildNumberedPdf(40);
    gemini.generateContent.mockResolvedValue(
      reply('[page 1]\n\n\n[page 2]\nkept')
    );

    const result = await runOcrOnPdfPages(buffer, [7, 22]);

    expect(result).toEqual({ 22: 'kept' });
  }, 60000);

  it('caps the pages sent and reports the ones it dropped', async () => {
    const buffer = await buildNumberedPdf(40);
    gemini.generateContent.mockResolvedValue(reply('[page 1]\nonly'));

    const result = await runOcrOnPdfPages(buffer, [3, 1, 9, 2, 30]);

    // OCR_MAX_TABLE_PAGES is 3 above, and the list is sorted before slicing.
    expect((await PDFDocument.load(sentPdf())).getPageCount()).toBe(3);
    expect(result).toEqual({ 1: 'only' });
  }, 60000);

  it('makes no call when there are no table pages', async () => {
    const buffer = await buildNumberedPdf(4);

    await expect(runOcrOnPdfPages(buffer, [])).resolves.toEqual({});
    expect(gemini.generateContent).not.toHaveBeenCalled();
  }, 60000);
});
