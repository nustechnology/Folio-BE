import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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

// ---------------------------------------------------------------------------
// SSRF protection for web extraction.
//
// `sourceUrl` is user-controlled, so we must never let fetch() reach an
// internal address (loopback, link-local, cloud metadata, private ranges) —
// either directly or via a redirect. The API boundary validates the scheme
// (http/https) but not the destination, and automatic redirect following would
// happily hop from a public URL onto an internal one.
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 5;
// Per-hop timeout so a slow or hanging destination cannot stall the worker.
const WEB_FETCH_TIMEOUT_MS = 15000;
// Hard cap on a fetched HTML body, before it is parsed, so a huge page cannot
// exhaust worker memory.
const MAX_WEB_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

// IP ranges an ingestion worker must never connect to (loopback, private,
// link-local incl. cloud metadata, and other non-routable/reserved ranges).
// net.BlockList rejects IPv6 on this Node version, so ranges are matched
// manually below.
const ipv4ToBigInt = (ip: string): bigint => {
  const [a, b, c, d] = ip.split('.').map(Number);
  return (
    (BigInt(a) << BigInt(24)) |
    (BigInt(b) << BigInt(16)) |
    (BigInt(c) << BigInt(8)) |
    BigInt(d)
  );
};

// Parse an IPv6 address into a 128-bit value. Handles `::` compression and an
// embedded dotted-quad IPv4 group (e.g. ::ffff:127.0.0.1), which counts as the
// final two hextets.
const ipv6ToBigInt = (ip: string): bigint => {
  const doubleColon = ip.indexOf('::');
  const left = doubleColon === -1 ? ip : ip.slice(0, doubleColon);
  const right = doubleColon === -1 ? '' : ip.slice(doubleColon + 2);

  const expandDottedQuad = (parts: string[]): string[] => {
    const hextets: string[] = [];
    for (const part of parts) {
      if (part.includes('.')) {
        const [a, b, c, d] = part.split('.').map(Number);
        hextets.push(((a << 8) | b).toString(16));
        hextets.push(((c << 8) | d).toString(16));
      } else {
        hextets.push(part);
      }
    }
    return hextets;
  };

  const leftParts = expandDottedQuad(
    left ? left.split(':').filter(Boolean) : []
  );
  const rightParts = expandDottedQuad(
    right ? right.split(':').filter(Boolean) : []
  );
  const missing = 8 - leftParts.length - rightParts.length;
  const hextets = [...leftParts, ...Array(missing).fill('0'), ...rightParts];
  let value = BigInt(0);
  for (const h of hextets) {
    value = (value << BigInt(16)) | BigInt(parseInt(h || '0', 16));
  }
  return value;
};

type IpRange = { network: bigint; bits: number; family: 4 | 6 };

const blockedRanges: IpRange[] = [
  { network: ipv4ToBigInt('0.0.0.0'), bits: 8, family: 4 }, // "this" network
  { network: ipv4ToBigInt('10.0.0.0'), bits: 8, family: 4 }, // private
  { network: ipv4ToBigInt('100.64.0.0'), bits: 10, family: 4 }, // carrier-grade NAT
  { network: ipv4ToBigInt('127.0.0.0'), bits: 8, family: 4 }, // loopback
  { network: ipv4ToBigInt('169.254.0.0'), bits: 16, family: 4 }, // link-local (metadata)
  { network: ipv4ToBigInt('172.16.0.0'), bits: 12, family: 4 }, // private
  { network: ipv4ToBigInt('192.168.0.0'), bits: 16, family: 4 }, // private
  { network: ipv4ToBigInt('198.18.0.0'), bits: 15, family: 4 }, // benchmarking
  { network: ipv4ToBigInt('224.0.0.0'), bits: 4, family: 4 }, // multicast
  { network: ipv4ToBigInt('240.0.0.0'), bits: 4, family: 4 }, // reserved
  { network: ipv6ToBigInt('::'), bits: 128, family: 6 }, // unspecified
  { network: ipv6ToBigInt('::1'), bits: 128, family: 6 }, // loopback
  { network: ipv6ToBigInt('fc00::'), bits: 7, family: 6 }, // unique local addresses
  { network: ipv6ToBigInt('fe80::'), bits: 10, family: 6 }, // link-local
  { network: ipv6ToBigInt('2001:db8::'), bits: 32, family: 6 }, // documentation
  { network: ipv6ToBigInt('100::'), bits: 64, family: 6 } // discard-only
];

// Reduce IPv4-mapped IPv6 (::ffff:0:0/96) to the embedded IPv4 dotted quad so
// the IPv4 blocked-range checks apply. This catches every representation —
// dotted quad (::ffff:127.0.0.1), canonical hex (::ffff:7f00:1), and full
// (0:0:0:0:0:ffff:7f00:1) — which a dotted-quad-only regex would miss. Other
// addresses are returned unchanged.
const normalizeIp = (ip: string): string => {
  const lower = ip.toLowerCase();
  if (isIP(lower) !== 6) {
    return lower;
  }
  const value = ipv6ToBigInt(lower);
  if (value >> BigInt(32) === BigInt(0xffff)) {
    const v4 = value & BigInt(0xffffffff);
    return [
      Number((v4 >> BigInt(24)) & BigInt(0xff)),
      Number((v4 >> BigInt(16)) & BigInt(0xff)),
      Number((v4 >> BigInt(8)) & BigInt(0xff)),
      Number(v4 & BigInt(0xff))
    ].join('.');
  }
  return lower;
};

const isBlockedIp = (ip: string): boolean => {
  const normalized = normalizeIp(ip);
  const family = isIP(normalized);
  if (!family) {
    return false;
  }
  const maxBits = family === 4 ? 32 : 128;
  const value =
    family === 4 ? ipv4ToBigInt(normalized) : ipv6ToBigInt(normalized);
  return blockedRanges.some((range) => {
    if (range.family !== family) {
      return false;
    }
    const mask =
      range.bits === 0
        ? BigInt(0)
        : ((BigInt(1) << BigInt(range.bits)) - BigInt(1)) <<
          BigInt(maxBits - range.bits);
    return (value & mask) === (range.network & mask);
  });
};

// Reject a URL whose scheme isn't http(s) or whose host resolves to any blocked
// (internal) address. The lookup happens before fetch(), so a hostile hostname
// could still flip its DNS answer afterwards (DNS rebinding); pinning the
// connection to the validated IP is the fully robust defence and is out of
// scope for this minimal fix.
const assertSafeUrl = async (rawUrl: string): Promise<void> => {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    throw new Error('URL is missing a host.');
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Blocked destination: ${hostname}`);
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = (await lookup(hostname, { all: true, verbatim: true })).map(
      (record) => record.address
    );
  } catch {
    throw new Error(`Failed to resolve host: ${hostname}`);
  }

  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new Error(
      `Destination resolves to a blocked (private/loopback/link-local) address: ${hostname}`
    );
  }
};

// Read a fetch response body into a Buffer, hard-capping it so a huge page
// cannot exhaust worker memory before JSDOM parsing. A Content-Length header
// over the limit is rejected up front; streamed/chunked bodies are capped as
// they arrive.
const readBodyWithLimit = async (
  response: Response,
  maxBytes: number
): Promise<Buffer> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Response body exceeds the ${maxBytes} byte limit.`);
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Response body exceeds the ${maxBytes} byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
};

// Fetch with manual redirect handling: every hop (the initial URL and each
// Location target) passes assertSafeUrl before a request is sent, redirects are
// bounded to prevent loops, and each hop is aborted if it exceeds
// WEB_FETCH_TIMEOUT_MS. Redirect bodies are drained with a size cap. Returns
// the first non-3xx response, so the caller keeps the existing
// `response.ok` / body parsing.
const fetchApproved = async (urlString: string): Promise<Response> => {
  let current = urlString;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertSafeUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Folio-RAG/1.0' },
        signal: controller.signal
      });

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has('location')
      ) {
        const next = new URL(
          response.headers.get('location')!,
          current
        ).toString();
        // Drain (capped) + release the socket for the redirect body.
        await readBodyWithLimit(response, MAX_WEB_BODY_BYTES).catch(() => {});
        if (next === current) {
          throw new Error('Redirect loop detected.');
        }
        current = next;
        continue;
      }

      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Request to ${current} timed out.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
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
  const response = await fetchApproved(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }
  const html = (await readBodyWithLimit(response, MAX_WEB_BODY_BYTES)).toString(
    'utf8'
  );
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
