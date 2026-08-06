import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '~/config/enviroment';
import logger from '~/config/logger';

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrError';
  }
}

const OCR_MODEL = 'gemini-3.6-flash';
const MAX_INLINE_PDF_BYTES = 20 * 1024 * 1024; // 20 MB Gemini inline limit

// Sends the raw PDF buffer to Gemini 3.6 Flash and returns extracted text.
// Output format mirrors pdfjs-dist: "[page N]\n<text>\n\n" per page.
export const runOcrOnPdf = async (
  buffer: Buffer,
  numPages: number
): Promise<string> => {
  if (!env.GEMINI_API_KEY) {
    throw new OcrError(
      'OCR requested but GEMINI_API_KEY is not set. ' +
        'Add GEMINI_API_KEY to your .env file.'
    );
  }

  if (buffer.length > MAX_INLINE_PDF_BYTES) {
    throw new OcrError(
      `PDF is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, ` +
        `which exceeds the ${MAX_INLINE_PDF_BYTES / 1024 / 1024} MB inline limit ` +
        `for Gemini OCR. Use a smaller file or implement File API upload.`
    );
  }

  logger.info('[OCR] Sending scanned PDF to Gemini 3.6 Flash', {
    sizeBytes: buffer.length,
    numPages
  });

  try {
    const genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = genai.getGenerativeModel({ model: OCR_MODEL });

    const prompt =
      'Extract all text from this PDF document. ' +
      'Preserve the original reading order and formatting as best you can. ' +
      'If you find any tables, format them using markdown table syntax. ' +
      'Begin each page\'s content with a marker in the exact format "[page N]" ' +
      '(where N is the page number, starting at 1), followed by a newline. ' +
      'Separate pages with a blank line. ' +
      'Do not wrap the entire output in markdown code blocks, and do not add any conversational commentary.';

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: buffer.toString('base64')
        }
      },
      prompt
    ]);

    const text = result.response.text().trim();

    logger.info('[OCR] Gemini OCR completed', {
      outputLength: text.length
    });

    return text;
  } catch (error: any) {
    logger.error('[OCR] Gemini API call failed', {
      message: error.message,
      stack: error.stack
    });
    throw new OcrError(`Gemini OCR failed: ${error.message}`);
  }
};

export const runOcrOnPdfPages = async (
  buffer: Buffer,
  pageNumbers: number[]
): Promise<Record<number, string>> => {
  if (!env.GEMINI_API_KEY) {
    throw new OcrError(
      'OCR requested but GEMINI_API_KEY is not set. ' +
        'Add GEMINI_API_KEY to your .env file.'
    );
  }

  if (buffer.length > MAX_INLINE_PDF_BYTES) {
    throw new OcrError(
      `PDF is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, ` +
        `which exceeds the ${MAX_INLINE_PDF_BYTES / 1024 / 1024} MB inline limit.`
    );
  }

  logger.info(
    '[OCR] Sending PDF to Gemini for specific page table extraction',
    {
      sizeBytes: buffer.length,
      pagesToOcr: pageNumbers
    }
  );

  try {
    const genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = genai.getGenerativeModel({ model: OCR_MODEL });

    const prompt =
      `Please extract the text and reconstruct any tables ONLY from the following pages of the PDF: ${pageNumbers.join(', ')}. ` +
      `Do not extract or return any content from any other pages in the document. ` +
      `For each requested page, begin its content with a marker in the exact format "[page N]" ` +
      `(where N is the page number), followed by a newline. ` +
      `Format all tables on these pages using markdown table syntax. ` +
      `Separate page outputs with a blank line. ` +
      `Do not wrap the output in markdown code blocks, and do not add any conversational commentary.`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: buffer.toString('base64')
        }
      },
      prompt
    ]);

    const text = result.response.text().trim();
    logger.info('[OCR] Specific page table extraction completed');

    const pageMap: Record<number, string> = {};
    const pageSegments = text.split(/\[page (\d+)\]/);

    for (let i = 1; i < pageSegments.length; i += 2) {
      const pageNum = Number(pageSegments[i]);
      const pageText = pageSegments[i + 1]?.trim() || '';
      pageMap[pageNum] = pageText;
    }

    return pageMap;
  } catch (error: any) {
    logger.error('[OCR] Gemini page table extraction failed', {
      message: error.message,
      stack: error.stack
    });
    throw new OcrError(`Gemini table extraction failed: ${error.message}`);
  }
};

export default { runOcrOnPdf, runOcrOnPdfPages };
