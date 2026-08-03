import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import pLimit from 'p-limit';

import { getFileExtension } from '~/api/utils/file.util';
import { downloadObject } from '~/api/utils/minio.util';
import type { SourceType } from '~/generated/prisma/enums';

// ExtractInput is what the worker feeds in; sourceUrl is the MinIO object key
// for File sources or the article URL for Web sources.
export type ExtractInput = {
  sourceType: SourceType;
  sourceUrl?: string | null;
  content?: string;
};

export type ExtractResult = {
  content: string;
  title?: string;
  author?: string;
  pageCount?: number;
  characterCount: number;
};

// Rough tag stripper for XML-based containers (PPTX slides, XLSX strings,
// EPUB documents) — good enough to pull readable text without a full HTML parser.
const stripTags = (xml: string): string => {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// PDF: pdfjs-dist is ESM-only, hence the dynamic import (the project compiles
// to CommonJS). Text is read page-by-page with a `[page N]` marker preserved so
// the chunking pipeline can attach page-level citation locators later.
const extractFromPdf = async (buffer: Buffer): Promise<string> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (item as { str?: string }).str ?? '')
      .join(' ');
    text += `[page ${i}]\n${pageText}\n\n`;
  }

  return text.trim();
};

// DOCX: mammoth converts the document to plain text directly from a buffer.
const extractFromDocx = async (buffer: Buffer): Promise<string> => {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
};

// Markdown: parsed to an mdast tree (remark supports GitHub-flavored markdown),
// then flattened to plain text via mdast-util-to-string. These packages are
// ESM-only, hence dynamic imports.
const extractFromMarkdown = async (buffer: Buffer): Promise<string> => {
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  const { toString } = await import('mdast-util-to-string');

  const text = buffer.toString('utf8');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
  return toString(tree as never).trim();
};

// Plain text (txt/csv): no parsing needed, just decode UTF-8.
const extractFromPlainText = (buffer: Buffer): string => {
  return buffer.toString('utf8').trim();
};

// PPTX: PowerPoint files are ZIP archives; slide text lives in
// ppt/slides/slideN.xml. Extract text from each slide in page order.
const extractFromPptx = async (buffer: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)\.xml$/)?.[1]) -
        Number(b.match(/slide(\d+)\.xml$/)?.[1])
    );

  let text = '';
  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    text += `${stripTags(xml)}\n`;
  }
  return text.trim();
};

const extractFromXlsx = async (buffer: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer);
  const shared = zip.file('xl/sharedStrings.xml');
  if (!shared) return '';

  const xml = await shared.async('string');
  const cells =
    xml
      .match(/<si>[\s\S]*?<\/si>/g)
      ?.map((si) => stripTags(si))
      .filter(Boolean) ?? [];
  return cells.join('\n').trim();
};

const extractFromEpub = async (buffer: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter(
    (file) => !file.dir && /\.(x?html|htm)$/i.test(file.name)
  );

  const limit = pLimit(4);
  const parts = await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const xml = await entry.async('string');
        return stripTags(xml);
      })
    )
  );
  return parts.filter(Boolean).join('\n').trim();
};

const extractFromWeb = async (
  url: string
): Promise<{
  content: string;
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
  if (input.sourceType === 'Manual') {
    const content = sanitizeText(extractFromManual(input.content || ''));
    return { content, characterCount: content.length };
  }

  if (input.sourceType === 'Web') {
    if (!input.sourceUrl) {
      throw new Error('Web source is missing a URL.');
    }
    const { content, title, author } = await extractFromWeb(input.sourceUrl);
    const cleanContent = sanitizeText(content);
    return {
      content: cleanContent,
      title,
      author,
      characterCount: cleanContent.length
    };
  }

  if (!input.sourceUrl) {
    throw new Error('File source is missing an object key.');
  }

  const buffer = await downloadObject(input.sourceUrl);
  const ext = getFileExtension(input.sourceUrl) ?? '';
  let content = '';

  switch (ext) {
    case 'pdf':
      content = await extractFromPdf(buffer);
      break;
    case 'docx':
      content = await extractFromDocx(buffer);
      break;
    case 'md':
      content = await extractFromMarkdown(buffer);
      break;
    case 'pptx':
      content = await extractFromPptx(buffer);
      break;
    case 'xlsx':
      content = await extractFromXlsx(buffer);
      break;
    case 'epub':
      content = await extractFromEpub(buffer);
      break;
    case 'txt':
    case 'csv':
      content = extractFromPlainText(buffer);
      break;
    default:
      throw new Error(`Unsupported file extension for extraction: .${ext}`);
  }

  if (!content) {
    throw new Error('No extractable text found in the file.');
  }

  const cleanContent = sanitizeText(content);
  return { content: cleanContent, characterCount: cleanContent.length };
};

export default { extract };
