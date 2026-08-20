import {
  GoogleGenerativeAI,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIError,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIRequestInputError,
  GoogleGenerativeAIResponseError
} from '@google/generative-ai';
import type { GenerateContentResult, Part } from '@google/generative-ai';
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

// The limit is on the request payload, and the PDF rides in it as base64, which
// inflates it by 4/3 — so a 19 MB file is a ~25 MB request. Size the check on
// the encoded length, computed rather than measured so an oversized file is
// rejected without first allocating the string it would have produced.
const base64Length = (byteLength: number) => 4 * Math.ceil(byteLength / 3);

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

// Settings arrive as strings and are never checked numerically, so a typo would
// reach the retry loop below as NaN — where `attempt >= NaN` is false on every
// pass and the loop never terminates. Anything not an integer at or above `min`
// falls back rather than being allowed to disable the bound it represents.
const intSetting = (raw: string, fallback: number, min: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
};

// The SDK arms an abort signal only when it is handed a timeout (or a signal of
// our own), so without this an OCR call has no deadline at all — a stalled
// connection would park an ingestion worker indefinitely. Passed per model
// instance, which means every attempt below is bounded separately.
//
// Deliberately not the gateway's MODEL_REQUEST_TIMEOUT_MS: that budget is sized
// for a chat completion, and OCR of a long scanned PDF routinely runs minutes
// past it. Sharing it would fail work that was merely slow.
const REQUEST_TIMEOUT_MS = intSetting(env.OCR_REQUEST_TIMEOUT_MS, 300_000, 1);
// Retries *after* the first attempt, matching how the model gateway reads the
// same setting for its OpenAI client. Zero is a valid choice, hence `min` 0.
const MAX_RETRIES = intSetting(env.MODEL_MAX_RETRIES, 1, 0);

// Rate limiting and the provider's own bad days. Anything else — a rejected
// key, a malformed request, a safety block — fails identically on every
// attempt, so retrying it only delays the error the caller already has.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

const isTransient = (error: unknown): boolean => {
  // Our own deadline fired. Gemini bills the work it had already done even
  // though we hung up, and a retry hands the same slow document to the same
  // model, so paying twice to reach the same timeout is a poor trade.
  if (error instanceof GoogleGenerativeAIAbortError) {
    return false;
  }

  if (
    error instanceof GoogleGenerativeAIResponseError ||
    error instanceof GoogleGenerativeAIRequestInputError
  ) {
    return false;
  }

  if (error instanceof GoogleGenerativeAIFetchError) {
    return error.status !== undefined && TRANSIENT_STATUSES.has(error.status);
  }

  // What is left from the SDK is the network layer: DNS failures, resets,
  // connections dropped before a status ever arrived.
  return error instanceof GoogleGenerativeAIError;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const retryDelayMs = (attempt: number) =>
  Math.min(30_000, 2_000 * 2 ** attempt);

// One OCR round-trip, bounded by REQUEST_TIMEOUT_MS and retried while the
// failure looks like the provider rather than the request.
const generateWithRetry = async (
  parts: (string | Part)[],
  context: Record<string, unknown>
): Promise<GenerateContentResult> => {
  // Built per call rather than at module load: the key is read from `env` at
  // call time, and callers have already checked it is set.
  const model = new GoogleGenerativeAI(env.GEMINI_API_KEY).getGenerativeModel(
    { model: OCR_MODEL },
    { timeout: REQUEST_TIMEOUT_MS }
  );

  for (let attempt = 0; ; attempt++) {
    try {
      return await model.generateContent(parts);
    } catch (error: unknown) {
      if (!isTransient(error) || attempt >= MAX_RETRIES) {
        throw error;
      }

      const delay = retryDelayMs(attempt);
      logger.warn('[OCR] Gemini call failed, retrying', {
        ...context,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: delay,
        status:
          error instanceof GoogleGenerativeAIFetchError
            ? error.status
            : undefined,
        message: error instanceof Error ? error.message : String(error)
      });
      await sleep(delay);
    }
  }
};

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

  if (base64Length(buffer.length) > MAX_INLINE_PDF_BYTES) {
    throw new OcrError(
      `PDF is ${megabytes(buffer.length)} MB, ` +
        `or ${megabytes(base64Length(buffer.length))} MB once base64-encoded, ` +
        `which exceeds the ${MAX_INLINE_PDF_BYTES / 1024 / 1024} MB inline limit ` +
        `for Gemini OCR. Use a smaller file or implement File API upload.`
    );
  }

  logger.info('[OCR] Sending scanned PDF to Gemini 3.6 Flash', {
    sizeBytes: buffer.length,
    numPages
  });

  try {
    const prompt =
      'Extract all text from this PDF document. ' +
      'Preserve the original reading order and formatting as best you can. ' +
      'If you find any tables, format them using markdown table syntax. ' +
      'Begin each page\'s content with a marker in the exact format "[page N]" ' +
      '(where N is the page number, starting at 1), followed by a newline. ' +
      'Separate pages with a blank line. ' +
      'Do not wrap the entire output in markdown code blocks, and do not add any conversational commentary.';

    const result = await generateWithRetry(
      [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: buffer.toString('base64')
          }
        },
        prompt
      ],
      { sizeBytes: buffer.length, numPages }
    );

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

  if (base64Length(buffer.length) > MAX_INLINE_PDF_BYTES) {
    throw new OcrError(
      `PDF is ${megabytes(buffer.length)} MB, ` +
        `or ${megabytes(base64Length(buffer.length))} MB once base64-encoded, ` +
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
    const prompt =
      `Please extract the text and reconstruct any tables ONLY from the following pages of the PDF: ${pageNumbers.join(', ')}. ` +
      `Do not extract or return any content from any other pages in the document. ` +
      `For each requested page, begin its content with a marker in the exact format "[page N]" ` +
      `(where N is the page number), followed by a newline. ` +
      `Format all tables on these pages using markdown table syntax. ` +
      `Separate page outputs with a blank line. ` +
      `Do not wrap the output in markdown code blocks, and do not add any conversational commentary.`;

    const result = await generateWithRetry(
      [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: buffer.toString('base64')
          }
        },
        prompt
      ],
      { sizeBytes: buffer.length, pagesToOcr: pageNumbers }
    );

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
