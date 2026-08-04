import { JSDOM } from 'jsdom';

import { getFileExtension } from '~/api/utils/file.util';
import { downloadObject } from '~/api/utils/minio.util';
import logger from '~/config/logger';
import type { SourceType } from '~/generated/prisma/enums';
import ParseService from '~/api/services/parse.service';

// ExtractInput is what the worker feeds in; sourceUrl is the MinIO object key
// for File sources or the article URL for Web sources.
export type ExtractInput = {
  sourceType: SourceType;
  sourceUrl?: string | null;
  content?: string;
  fileType?: string | null;
};

export type ExtractResult = {
  content: string;
  structuredContent?: any;
  title?: string;
  author?: string;
  pageCount?: number;
  characterCount: number;
};

const getFormatFromMimeAndExt = (
  mimeType?: string | null,
  ext?: string | null
): string => {
  if (mimeType) {
    const mime = mimeType.split(';')[0].trim().toLowerCase();
    if (mime === 'application/pdf') return 'pdf';
    if (
      mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
      return 'docx';
    if (
      mime === 'text/markdown' ||
      mime === 'text/x-markdown' ||
      mime === 'text/md'
    )
      return 'md';
    if (
      mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
      return 'pptx';
    if (
      mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
      return 'xlsx';
    if (mime === 'application/epub+zip') return 'epub';
    if (mime === 'text/plain') return 'txt';
    if (mime === 'text/csv') return 'csv';
  }
  return ext?.toLowerCase() || '';
};

const extractFromWeb = async (
  url: string
): Promise<{
  content: string;
  html?: string;
  title?: string;
  author?: string;
}> => {
  // Fetch the article, render it with jsdom, then run Mozilla's Readability to
  // strip navigation/ads and keep only the main article text. Also extracts the
  // page <title> and <meta name="author"> so they can fill blank source fields.
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Folio-RAG/1.0' }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }
  const html = await response.text();
  const dom = new JSDOM(html, { url });

  const { Readability } = await import('@mozilla/readability');
  const article = new Readability(dom.window.document).parse();

  const title =
    article?.title ||
    dom.window.document.querySelector('title')?.textContent?.trim() ||
    undefined;
  const author =
    dom.window.document
      .querySelector('meta[name="author"]')
      ?.getAttribute('content')
      ?.trim() || undefined;

  return {
    content: (article?.textContent || '').trim(),
    html: article?.content || '',
    title,
    author
  };
};

const extractFromManual = (content: string): string => content.trim();

// Strip control characters (0x00 etc.) that some extractors emit (e.g. pdfjs
// from embedded fonts). PostgreSQL rejects null bytes in TEXT columns, so this
// MUST run before content is written back to the source.
const sanitizeText = (text: string): string => {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

// Dispatcher: picks the extractor based on source type and returns sanitized
// text + metadata. File sources are downloaded from MinIO first.
export const extract = async (input: ExtractInput): Promise<ExtractResult> => {
  logger.info('[Extractor] Starting content extraction', {
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    fileType: input.fileType
  });

  if (input.sourceType === 'Manual') {
    logger.debug('[Extractor] Parsing manual text source');
    const rawContent = extractFromManual(input.content || '');
    const cleanContent = sanitizeText(rawContent);
    const paragraphsHtml = cleanContent
      .split(/\n\s*\n/)
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('');

    logger.debug('[Extractor] Manual text parsed successfully', {
      charCount: cleanContent.length
    });
    return {
      content: cleanContent,
      structuredContent: {
        type: 'document',
        html: paragraphsHtml
      },
      characterCount: cleanContent.length
    };
  }

  if (input.sourceType === 'Web') {
    if (!input.sourceUrl) {
      logger.error('[Extractor] Missing URL for Web source');
      throw new Error('Web source is missing a URL.');
    }
    logger.debug('[Extractor] Running readability parser on web page', {
      url: input.sourceUrl
    });
    const { content, html, title, author } = await extractFromWeb(
      input.sourceUrl
    );
    const cleanContent = sanitizeText(content);
    logger.info('[Extractor] Web content parsed successfully', {
      title,
      author,
      charCount: cleanContent.length
    });

    return {
      content: cleanContent,
      structuredContent: {
        type: 'document',
        html: html || `<p>${cleanContent.replace(/\n/g, '<br/>')}</p>`
      },
      title,
      author,
      characterCount: cleanContent.length
    };
  }

  if (!input.sourceUrl) {
    logger.error('[Extractor] Missing object key for File source');
    throw new Error('File source is missing an object key.');
  }

  logger.debug('[Extractor] Downloading object from MinIO bucket', {
    objectKey: input.sourceUrl
  });
  const buffer = await downloadObject(input.sourceUrl);
  const ext = getFileExtension(input.sourceUrl) ?? '';
  const format = getFormatFromMimeAndExt(input.fileType, ext);

  logger.info('[Extractor] Selected file extraction strategy', {
    resolvedFormat: format,
    fileSize: buffer.length,
    originalExtension: ext,
    fileType: input.fileType
  });

  const parseResult = await ParseService.parse(format, buffer);

  if (!parseResult.content) {
    throw new Error('No extractable text found in the file.');
  }

  const cleanContent = sanitizeText(parseResult.content);
  return {
    content: cleanContent,
    structuredContent: parseResult.structuredContent,
    characterCount: cleanContent.length
  };
};

export default { extract };
