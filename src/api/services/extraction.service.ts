import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { JSDOM } from 'jsdom';

import { createMediaSink } from '~/api/services/media.service';
import { getFileExtension } from '~/api/utils/file.util';
import { htmlToText } from '~/api/utils/html-to-text.util';
import { downloadObject } from '~/api/utils/minio.util';
import { escapeHtml } from '~/api/utils/source-html.util';
import logger from '~/config/logger';
import type { SourceType } from '~/generated/prisma/enums';
import ParseService from '~/api/services/parse.service';

// ExtractInput is what the worker feeds in; sourceUrl is the MinIO object key
// for File sources or the article URL for Web sources.
export type ExtractInput = {
  sourceId: string;
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
type ResolvedHost = {
  hostname: string;
  ip: string;
  family: number;
};

// Resolve and validate a URL's host, returning the exact IP the connection must
// be pinned to. The address is resolved HERE and then forced at connect time
// (via a lookup override), so a hostile hostname cannot flip its DNS answer
// between validation and connection (DNS rebinding) to route the request to a
// private address.
const resolveAndValidate = async (rawUrl: string): Promise<ResolvedHost> => {
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
    return { hostname, ip: hostname, family: isIP(hostname) };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Failed to resolve host: ${hostname}`);
  }

  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error(
      `Destination resolves to a blocked (private/loopback/link-local) address: ${hostname}`
    );
  }

  return {
    hostname,
    ip: addresses[0].address,
    family: addresses[0].family
  };
};

// Read a fetch response body into a Buffer, hard-capping it so a huge page
// cannot exhaust worker memory before JSDOM parsing. A Content-Length header
// over the limit is rejected up front; streamed/chunked bodies are capped as
// they arrive. If the caller's per-hop deadline (abort signal) fires mid-body,
// a clear timeout error is thrown instead of returning a truncated body.
const readBodyWithLimit = async (
  response: http.IncomingMessage,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMessage = 'Request timed out.'
): Promise<Buffer> => {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy(); // close the socket immediately (no keep-alive reuse)
    throw new Error(`Response body exceeds the ${maxBytes} byte limit.`);
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of response) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      response.destroy();
      throw new Error(`Response body exceeds the ${maxBytes} byte limit.`);
    }
    chunks.push(buf);
  }

  // The deadline can abort the request mid-body (socket torn down → the
  // stream just ends early); surface that as a timeout rather than parsing a
  // truncated page as if it succeeded.
  if (signal?.aborted) {
    throw new Error(timeoutMessage);
  }

  return Buffer.concat(chunks);
};

// Result of one pinned HTTP(S) hop. The per-hop deadline (timer + abort
// listener) stays active after the response headers arrive, so the caller must
// call `cleanup()` once the body has been fully consumed (or the hop fails).
type Hop = {
  response: http.IncomingMessage;
  cleanup: () => void;
  signal: AbortSignal;
  // The last hop after redirects, which relative links resolve against.
  finalUrl: string;
};

// Perform a single HTTP(S) hop pinned to a pre-validated IP. The `lookup`
// override forces the socket to connect to `resolved.ip` for the expected
// hostname, so DNS cannot be re-resolved to a private address at connect time
// (DNS rebinding). The request keeps the real hostname for the Host header and
// TLS SNI, so virtual hosting and certificate validation still work. Aborts the
// hop if it exceeds WEB_FETCH_TIMEOUT_MS — the deadline covers header receipt
// AND body consumption (see readBodyWithLimit).
const fetchHop = async (url: string): Promise<Hop> => {
  const parsed = new URL(url);
  const { hostname, ip, family } = await resolveAndValidate(url);
  const transport = parsed.protocol === 'https:' ? https : http;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  let request: http.ClientRequest | undefined;
  const onAbort = () => request?.destroy(new Error('timed out'));
  controller.signal.addEventListener('abort', onAbort);
  const cleanup = () => {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
  };

  try {
    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        request = transport.request(
          {
            hostname,
            port: parsed.port ? Number(parsed.port) : undefined,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'GET',
            servername: hostname,
            // No connection pooling: each hop gets a fresh socket that closes
            // once its response is consumed, so no lingering keep-alive sockets.
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              Connection: 'close'
            },
            lookup: (
              lookupHost: string,
              _opts: unknown,
              cb: (
                err: Error | null,
                addresses?: { address: string; family: number }[]
              ) => void
            ) => {
              if (lookupHost.toLowerCase() !== hostname) {
                cb(new Error('Unexpected hostname during lookup.'));
                return;
              }
              cb(null, [{ address: ip, family }]);
            }
          },
          (res) => resolve(res)
        );
        request.on('error', reject);
        request.end();
      }
    );
    // Success: keep the deadline + abort listener active so body consumption is
    // still bounded. The caller invokes `cleanup()` after the body is read.
    return { response, cleanup, signal: controller.signal, finalUrl: url };
  } catch (error) {
    cleanup(); // hop failed (including timeout) — the deadline is over
    if (controller.signal.aborted) {
      throw new Error(`Request to ${url} timed out.`);
    }
    throw error;
  }
};

// Fetch with manual redirect handling: every hop (the initial URL and each
// Location target) is resolved + validated and its connection pinned, redirects
// are bounded to prevent loops, and each hop's deadline covers header receipt
// and body consumption. Redirect bodies are drained with a size cap. Returns
// the first non-3xx hop.
const fetchApproved = async (urlString: string): Promise<Hop> => {
  let current = urlString;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const hop = await fetchHop(current);

    const status = hop.response.statusCode ?? 0;
    if (status >= 300 && status < 400 && hop.response.headers.location) {
      const next = new URL(hop.response.headers.location, current).toString();
      // Drain (capped) + release the socket for the redirect body, then stop
      // this hop's deadline before moving to the next one.
      try {
        await readBodyWithLimit(
          hop.response,
          MAX_WEB_BODY_BYTES,
          hop.signal,
          `Request to ${current} timed out.`
        ).catch(() => {});
      } finally {
        hop.cleanup();
      }
      if (next === current) {
        throw new Error('Redirect loop detected.');
      }
      current = next;
      continue;
    }

    return hop;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
};

// Relative URLs stop resolving once the markup is stored on its own, so they
// are rewritten against the URL the page came from.
const absolutizeUrls = (html: string, baseUrl: string): string => {
  const dom = new JSDOM(`<body>${html}</body>`);
  const { document } = dom.window;

  for (const [selector, attribute] of [
    ['img[src]', 'src'],
    ['a[href]', 'href']
  ] as const) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const value = element.getAttribute(attribute);
      if (!value || value.startsWith('#') || /^data:/i.test(value)) {
        continue;
      }
      try {
        element.setAttribute(attribute, new URL(value, baseUrl).toString());
      } catch {
        element.removeAttribute(attribute);
      }
    }
  }

  return document.body.innerHTML;
};

// Peel Jina Reader's `Key: value` header block off the article. It ends at
// `Markdown Content:`; without that marker the scan stops at the first line
// that isn't a key/value pair, so no prose is eaten.
const splitJinaPreamble = (
  markdown: string
): { meta: Record<string, string>; body: string } => {
  const lines = markdown.split(/\r?\n/);
  const meta: Record<string, string> = {};
  let index = 0;
  let sawMarker = false;

  for (; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    if (/^markdown content:$/i.test(line)) {
      sawMarker = true;
      index++;
      break;
    }

    const pair = line.match(/^([A-Za-z][A-Za-z ]{1,24}):\s*(.*)$/);
    if (!pair) {
      break;
    }
    meta[pair[1].trim().toLowerCase()] = pair[2].trim();
  }

  // No recognizable header at all — treat the whole payload as the article.
  if (!sawMarker && Object.keys(meta).length === 0) {
    return { meta, body: markdown };
  }

  return { meta, body: lines.slice(index).join('\n') };
};

const extractFromWeb = async (
  url: string
): Promise<{
  content: string;
  html?: string;
  title?: string;
  author?: string;
}> => {
  let contentText = '';
  let contentHtml = '';
  let title: string | undefined;
  let author: string | undefined;
  let fetchedViaJina = false;

  // 1. Try Jina Reader API first to get fully-rendered Markdown (executes client-side JS and cleans page)
  try {
    logger.info('[Extractor] Fetching page markdown via Jina Reader API', {
      url
    });
    // Encode target URL so query params like ?query=1&item=2 are preserved!
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);

    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        const parsed = new URL(jinaUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.request(
          {
            hostname: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : undefined,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'X-No-Cache': 'true',
              Connection: 'close'
            }
          },
          (res) => resolve(res)
        );
        req.on('error', reject);
        req.end();
      }
    );

    try {
      const status = response.statusCode ?? 0;
      if (status === 200) {
        const markdown = (
          await readBodyWithLimit(
            response,
            MAX_WEB_BODY_BYTES,
            controller.signal,
            `Request to Jina Reader timed out.`
          )
        ).toString('utf8');

        if (markdown.trim()) {
          // Jina prefixes the article with a `Title:/URL Source:/…` block.
          // Left in place it lands at the top of the reader and in the
          // embeddings.
          const { meta, body } = splitJinaPreamble(markdown);
          title = meta.title || title;
          author = meta.author || meta['published by'] || author;

          if (body.trim()) {
            const compiledHtml = await ParseService.markdownToHtml(body);
            contentHtml = ParseService.finalizeHtml(compiledHtml);
            // Same HTML, so tables survive as rows.
            contentText = htmlToText(contentHtml);

            fetchedViaJina = true;
            logger.info(
              '[Extractor] Successfully fetched and parsed markdown from Jina Reader',
              { charCount: contentText.length }
            );
          } else {
            logger.warn(
              '[Extractor] Jina Reader returned metadata but no article body'
            );
          }
        }
      } else {
        logger.warn('[Extractor] Jina Reader returned non-200 status', {
          status
        });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    logger.warn(
      '[Extractor] Jina Reader API failed, falling back to local crawl',
      { message: err.message }
    );
  }

  // 2. Direct local fetch fallback if Jina failed or returned empty content
  if (!fetchedViaJina) {
    logger.info('[Extractor] Fetching raw HTML locally', { url });
    const hop = await fetchApproved(url);
    let html = '';
    try {
      const status = hop.response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        await readBodyWithLimit(
          hop.response,
          MAX_WEB_BODY_BYTES,
          hop.signal,
          `Request to ${url} timed out.`
        ).catch(() => {});
        throw new Error(`Failed to fetch URL: ${status}`);
      }
      html = (
        await readBodyWithLimit(
          hop.response,
          MAX_WEB_BODY_BYTES,
          hop.signal,
          `Request to ${url} timed out.`
        )
      ).toString('utf8');
    } finally {
      hop.cleanup();
    }

    const dom = new JSDOM(html, { url });
    const { Readability } = await import('@mozilla/readability');
    const article = new Readability(dom.window.document).parse();

    title =
      article?.title ||
      dom.window.document.querySelector('title')?.textContent?.trim() ||
      undefined;
    author =
      dom.window.document
        .querySelector('meta[name="author"]')
        ?.getAttribute('content')
        ?.trim() || undefined;

    const readabilityText = (article?.textContent || '').trim();
    const readabilityHtml = article?.content || undefined;

    // Extract all raw body text/HTML to ensure we don't miss anything (e.g. dynamic elements, side content)
    const document = dom.window.document;
    const toRemove = document.querySelectorAll(
      'script, style, noscript, svg, iframe, nav, footer, header'
    );
    toRemove.forEach((el) => el.remove());
    const bodyText = (document.body?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const bodyHtml = document.body?.innerHTML || undefined;

    // If Readability was too aggressive (extracted less than 30% of the body text), use raw body text fallback
    if (!readabilityText || readabilityText.length < bodyText.length * 0.3) {
      logger.info(
        '[Extractor] Readability was too aggressive or empty — using raw body text fallback'
      );
      contentText = bodyText;
      contentHtml = bodyHtml || '';
    } else {
      contentText = readabilityText;
      contentHtml = readabilityHtml || '';
    }

    if (contentHtml) {
      // Resolved against the article URL before the HTML is stored.
      contentHtml = ParseService.finalizeHtml(
        absolutizeUrls(contentHtml, hop.finalUrl ?? url)
      );
      contentText = htmlToText(contentHtml) || contentText;
    }
  }

  return {
    content: contentText,
    html: contentHtml || undefined,
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
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
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
        // Page text with no usable markup; escaped since it is raw content.
        html:
          html || `<p>${escapeHtml(cleanContent).replace(/\n/g, '<br/>')}</p>`
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

  // Embedded images go to object storage under this source's prefix; the
  // stored HTML references them by URL.
  const parseResult = await ParseService.parse(format, buffer, {
    sourceId: input.sourceId,
    saveMedia: createMediaSink(input.sourceId)
  });

  if (!parseResult.content) {
    throw new Error('No extractable text found in the file.');
  }

  const cleanContent = sanitizeText(parseResult.content);
  return {
    content: cleanContent,
    structuredContent: parseResult.structuredContent,
    // Only when the file carries its own metadata (EPUB package, front matter).
    title: parseResult.title,
    author: parseResult.author,
    pageCount: parseResult.pageCount,
    characterCount: cleanContent.length
  };
};

export default { extract };
