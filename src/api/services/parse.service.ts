import JSZip from 'jszip';
import mammoth from 'mammoth';
import pLimit from 'p-limit';
import { JSDOM } from 'jsdom';
import { Marked } from 'marked';

import type { MediaSink } from '~/api/services/media.service';
import { runOcrOnPdf, runOcrOnPdfPages } from '~/api/services/ocr.service';
import { htmlToText } from '~/api/utils/html-to-text.util';
import { escapeHtml, sanitizeSourceHtml } from '~/api/utils/source-html.util';
import { env } from '~/config/enviroment';
import logger from '~/config/logger';

// Per-source hooks that don't belong to a buffer. Parsing without a context
// still works; the images are simply dropped.
export type ParseContext = {
  sourceId?: string;
  saveMedia?: MediaSink;
};

// A dedicated instance, not the shared `marked` singleton, so the renderer
// override below can't leak into other callers.
const markdown = new Marked({
  gfm: true,
  breaks: false
});

// Fenced languages we can't draw; they are labelled and shown as code.
const DIAGRAM_LANGUAGES = new Set([
  'mermaid',
  'plantuml',
  'puml',
  'graphviz',
  'dot',
  'vega',
  'vega-lite',
  'flow',
  'sequence',
  'gantt'
]);

markdown.use({
  renderer: {
    // Tag each block with its language so the reader can label it.
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      const body = `<pre><code${
        language ? ` class="language-${escapeHtml(language)}"` : ''
      }>${escapeHtml(text)}</code></pre>`;

      if (!language) {
        return body;
      }

      const kind = DIAGRAM_LANGUAGES.has(language) ? 'diagram' : 'code';
      return `<figure class="source-code-block" data-lang="${escapeHtml(
        language
      )}"${kind === 'diagram' ? ` data-diagram="${escapeHtml(language)}"` : ''}>${body}<figcaption>${escapeHtml(
        language
      )}${kind === 'diagram' ? ' diagram' : ''}</figcaption></figure>`;
    }
  }
});

export const markdownToHtml = async (source: string): Promise<string> =>
  (await markdown.parse(source)) as string;

// Left in place, Markdown renders front matter as a stray rule plus
// `key: value` lines. Only flat scalars are read.
const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export const splitFrontMatter = (
  text: string
): { body: string; meta: Record<string, string> } => {
  const match = text.match(FRONT_MATTER);
  if (!match) {
    return { body: text, meta: {} };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][\w.-]*)\s*:\s*(.*)$/);
    if (pair) {
      meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  return { body: text.slice(match[0].length), meta };
};

// XML text content arrives escaped, so a cell reading `Ben & Jerry's <3` is
// stored as `Ben &amp; Jerry&apos;s &lt;3`. Handles the five predefined
// entities plus decimal and hex character references, which is the whole set
// XML defines without a DTD. `&amp;` is unwrapped last so that an escaped
// entity (`&amp;lt;`) decodes to the literal `&lt;` rather than to `<`.
const decodeXmlEntities = (text: string): string => {
  const fromCodePoint = (code: number, raw: string) =>
    Number.isInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : raw; // out of range — leave it as written rather than throwing

  return text
    .replace(/&#x([0-9a-f]+);/gi, (raw, hex) =>
      fromCodePoint(parseInt(hex, 16), raw)
    )
    .replace(/&#(\d+);/g, (raw, dec) => fromCodePoint(Number(dec), raw))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
};

// Reads the text of one spreadsheet string, given the inside of an <si> (a
// shared string) or an <is> (a string stored inline in the cell). Both hold the
// same thing: either a single <t>, or — when the string carries mixed
// formatting — one <r> run per format, each with its own <t>, which have to be
// concatenated back into a single value.
const readXmlTextRuns = (fragment: string): string => {
  // Phonetic guides (furigana) sit in their own <rPh> runs alongside the real
  // text; they are an annotation, not part of the value.
  const body = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/gi, '');
  let text = '';
  // Self-closing first: tried second, the open-tag branch matches `<t/>` as an
  // opening tag and runs on to the next element's `</t>`.
  for (const run of body.matchAll(/<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/gi)) {
    text += run[1] ?? '';
  }
  return decodeXmlEntities(text);
};

// Rough tag stripper for XML-based containers (PPTX slides, XLSX strings,
// EPUB documents) — good enough to pull readable text without a full HTML parser.
const stripTags = (xml: string): string => {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Unzips the .xlsx file to parse its worksheets structurally. Resolves Excel shared strings,
// matches worksheets from workbook.xml, maps cell coordinates to table rows, and returns
// an array of sheets with headers and data rows.
const parseXlsxSheets = async (
  buffer: Buffer
): Promise<{ name: string; headers: string[]; rows: string[][] }[]> => {
  // Office OpenXML files (like .xlsx) are zipped collections of XML files.
  // We load the buffer as a ZIP archive to read individual spreadsheet components.
  const zip = await JSZip.loadAsync(buffer);

  // Excel stores a single copy of each unique string in xl/sharedStrings.xml to optimize file size.
  // We extract and decode this file first to build a lookup array for actual cell values.
  const sharedStrings: string[] = [];
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  if (sharedStringsFile) {
    const xml = await sharedStringsFile.async('string');
    // One entry per <si>, not per <t> — cells address this array by position,
    // so a multi-run string collected as several entries shifts every string
    // after it. The self-closing form has to be the first alternative: tried
    // second, the open-tag branch matches `<si/>` as an opening tag and runs on
    // to the next element's `</si>`, swallowing two entries into one.
    const siMatches = xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/gi);
    for (const si of siMatches) {
      // An empty <si/> still occupies an index, so it is pushed like any other.
      sharedStrings.push(readXmlTextRuns(si[1] ?? ''));
    }
  }

  // xl/workbook.xml lists the sheets defined in the spreadsheet, including their user-facing names.
  const workbookFile = zip.file('xl/workbook.xml');
  const sheetNames: string[] = [];
  if (workbookFile) {
    const xml = await workbookFile.async('string');
    // Match each <sheet> tag independently of attribute order
    const sheetTags = xml.match(/<sheet\s+[^>]+>/g) || [];
    for (const tag of sheetTags) {
      const nameMatch =
        tag.match(/name="([^"]+)"/i) || tag.match(/name='([^']+)'/i);
      if (nameMatch) {
        sheetNames.push(nameMatch[1]);
      }
    }
  }

  const sheets: { name: string; headers: string[]; rows: string[][] }[] = [];
  // Scan for sheet files (e.g. xl/worksheets/sheet1.xml) and sort them numerically so sheets match
  // the order parsed from workbook.xml.
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/sheet(\d+)\.xml$/)?.[1] || 0);
      const numB = Number(b.match(/sheet(\d+)\.xml$/)?.[1] || 0);
      return numA - numB;
    });

  for (let i = 0; i < sheetFiles.length; i++) {
    const fileName = sheetFiles[i];
    const xml = await zip.file(fileName)!.async('string');
    const sheetName = sheetNames[i] || `Sheet ${i + 1}`;

    const rowsMap: Record<number, Record<string, string>> = {};
    const colLetters = new Set<string>();

    // Each cell in a sheet is represented by a <c> tag. Both forms have to come
    // out of one scan, in document order: a styled-but-empty cell is written
    // self-closing, and trying the open-tag pattern first would match `<c r="A1"/>`
    // as an opening tag and consume everything up to the *next* `</c>`, handing
    // the following cell's value to this cell's column.
    const cMatches =
      xml.match(/<c\b[^>]*\/>|<c\b[^>]*>([\s\S]*?)<\/c>/gi) || [];
    for (const cMatch of cMatches) {
      // Read the cell's attributes off its opening tag only. A nested <f>
      // carries a `t` of its own ("shared", "array"), which a search over the
      // whole cell would pick up as if it were the cell's type.
      const openTag = cMatch.match(/^<c\b[^>]*>/i)?.[0] ?? cMatch;

      // Cell reference e.g. r="A1" maps to column "A", row "1"
      const rMatch =
        openTag.match(/r="([A-Z]+)(\d+)"/i) ||
        openTag.match(/r='([A-Z]+)(\d+)'/i);
      if (!rMatch) continue;
      const col = rMatch[1].toUpperCase();
      const row = Number(rMatch[2]);

      // t="s" indicates the cell's value is stored in sharedStrings.xml (shared string index).
      const tMatch =
        openTag.match(/t="([^"]+)"/i) || openTag.match(/t='([^']+)'/i);
      const isSharedString = tMatch && tMatch[1] === 's';

      // <v> is the value tag containing either the raw number or the sharedStrings index.
      const vMatch = cMatch.match(/<v>([^<]+)<\/v>/i);
      let value = '';
      if (vMatch) {
        const valStr = vMatch[1];
        if (isSharedString) {
          const idx = Number(valStr);
          value = sharedStrings[idx] || '';
        } else {
          // Numbers pass through untouched; string results of formulas are
          // escaped the same way shared strings are.
          value = decodeXmlEntities(valStr);
        }
      } else {
        // t="inlineStr": the string is not pooled, it sits in the cell inside
        // an <is> with the same run structure as a shared string. There is no
        // <v> to read in that case, so without this the cell reads as empty.
        const isMatch = cMatch.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i);
        if (isMatch) {
          value = readXmlTextRuns(isMatch[1]);
        }
      }

      if (!rowsMap[row]) {
        rowsMap[row] = {};
      }
      rowsMap[row][col] = value;
      colLetters.add(col);
    }

    // Sort column keys (A, B, ..., Z, AA, AB...) alphabetically and by character length
    const sortedCols = Array.from(colLetters).sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });

    // Sort row indices numerically
    const rowNumbers = Object.keys(rowsMap)
      .map(Number)
      .sort((a, b) => a - b);
    if (rowNumbers.length === 0) continue;

    const headers = sortedCols;
    const rows: string[][] = [];

    // Construct flat row arrays based on the grid structure we built
    for (const rNum of rowNumbers) {
      const rowData = sortedCols.map((col) => rowsMap[rNum][col] || '');
      rows.push(rowData);
    }

    // Identify headers: by default, we assume the first row represents column headers.
    let finalHeaders = headers;
    let finalRows = rows;
    if (rows.length > 0) {
      finalHeaders = rows[0];
      finalRows = rows.slice(1);
    }

    sheets.push({
      name: sheetName,
      headers: finalHeaders,
      rows: finalRows
    });
  }

  return sheets;
};

// Unzips the .pptx file, parses individual slide XML structures, and extracts text runs.
// Identifies slide titles (using title placeholder definitions) and builds lists of bullet points.
const parsePptxSlides = async (
  buffer: Buffer
): Promise<{ slideNumber: number; title: string; bullets: string[] }[]> => {
  // Office OpenXML files (like .pptx) are zipped collections of XML files.
  // We load the buffer as a ZIP archive to access individual slides.
  const zip = await JSZip.loadAsync(buffer);

  // Find all slide XML files and sort them numerically so slide data remains ordered.
  const slideNames = Object.keys(zip.files)
    .filter((name) => /ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)\.xml$/)?.[1]) -
        Number(b.match(/slide(\d+)\.xml$/)?.[1] || 0)
    );

  const slides: { slideNumber: number; title: string; bullets: string[] }[] =
    [];

  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i];
    const xml = await zip.file(name)!.async('string');

    // Slide text elements are defined inside shape elements (<p:sp>)
    const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
    let slideTitle = '';
    const bullets: string[] = [];

    for (const shape of shapes) {
      // Determine if this shape represents a slide title placeholder
      const isTitle =
        shape.includes('type="title"') ||
        shape.includes('type="ctrTitle"') ||
        shape.includes('type="subTitle"');

      // Extract paragraphs (<a:p>) and text runs (<a:t>) inside the shape
      const paragraphs = shape.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
      for (const para of paragraphs) {
        const textRuns = para.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
        const paraText = textRuns
          .map((run) => run.replace(/<[^>]+>/g, ''))
          .join('')
          .trim();

        if (paraText) {
          // If shape is a title, assign as slide title, otherwise list as bullet/body text
          if (isTitle && !slideTitle) {
            slideTitle = paraText;
          } else {
            bullets.push(paraText);
          }
        }
      }
    }

    // Fallback: use first bullet text as slide title if none matches a placeholder
    if (!slideTitle && bullets.length > 0) {
      slideTitle = bullets.shift() || '';
    }

    slides.push({
      slideNumber: i + 1,
      title: slideTitle || `Slide ${i + 1}`,
      bullets
    });
  }

  return slides;
};

// PDF: pdfjs-dist is used to read layout coordinate entries and reconstruct lines.
// Text is read page-by-page with a `[page N]` marker preserved so
// the chunking pipeline can attach page-level citation locators later.
type PdfDocument = Awaited<
  ReturnType<
    (typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']
  >['promise']
>;

// Reads every page of an already-open document. The page count goes out with
// the text so callers don't have to parse the same bytes a second time just to
// learn how many pages there were.
const readPdfPages = async (
  doc: PdfDocument
): Promise<{ text: string; tablePages: number[]; numPages: number }> => {
  let text = '';
  const tablePages: number[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as {
      str: string;
      transform: number[];
      width?: number;
      height?: number;
    }[];

    // 1. Find dominant body font size on the page (weighted by character length)
    const fontSizeCounts: Record<number, number> = {};
    for (const item of items) {
      if (!item.str.trim()) continue;
      const size = Math.round(item.height || Math.abs(item.transform[3]));
      if (size > 0) {
        fontSizeCounts[size] = (fontSizeCounts[size] || 0) + item.str.length;
      }
    }

    let bodyFontSize = 10;
    let maxCount = 0;
    for (const [sizeStr, count] of Object.entries(fontSizeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bodyFontSize = Number(sizeStr);
      }
    }

    // 2. Group items by vertical baseline (y coordinate is transform[5])
    const tolerance = 3; // 3pt baseline tolerance
    const linesMap: { y: number; items: typeof items }[] = [];

    for (const item of items) {
      if (!item.str.trim()) continue;
      const y = item.transform[5];

      const foundLine = linesMap.find(
        (line) => Math.abs(line.y - y) <= tolerance
      );
      if (foundLine) {
        foundLine.items.push(item);
      } else {
        linesMap.push({ y, items: [item] });
      }
    }

    // Sort lines from top to bottom
    linesMap.sort((a, b) => b.y - a.y);

    let pageText = '';
    let tableScore = 0;

    for (let j = 0; j < linesMap.length; j++) {
      const line = linesMap[j];

      // Calculate average font size of the line
      let totalLineChars = 0;
      let lineFontSizeSum = 0;
      for (const item of line.items) {
        const size = Math.round(item.height || Math.abs(item.transform[3]));
        if (size > 0) {
          lineFontSizeSum += size * item.str.length;
          totalLineChars += item.str.length;
        }
      }
      const lineFontSize =
        totalLineChars > 0 ? lineFontSizeSum / totalLineChars : bodyFontSize;

      // Dynamic spacing thresholds based on the line's font size (optimized for sensitivity)
      const wordGap = Math.max(2.5, lineFontSize * 0.2);
      const colGap = Math.max(9, lineFontSize * 0.9);

      // Sort items within the same line from left to right (x ascending)
      line.items.sort((a, b) => a.transform[4] - b.transform[4]);

      let lineText = '';
      let prevX = -1;
      let prevWidth = 0;
      let lineGapsCount = 0;

      for (const item of line.items) {
        const x = item.transform[4];
        if (prevX !== -1) {
          const gap = x - (prevX + prevWidth);
          // If the horizontal gap is larger than colGap, treat it as a column separator (tab)
          if (gap > colGap) {
            lineText += '\t';
            lineGapsCount++;
          } else if (gap > wordGap) {
            lineText += ' ';
          }
        }
        lineText += item.str;
        prevX = x;
        // Cap width to prevent PDF generator layout bloat from swallowing column gaps
        prevWidth = Math.min(
          item.width || item.str.length * (lineFontSize * 0.5),
          item.str.length * (lineFontSize * 0.55)
        );
      }

      // Add to table score if this row exhibits multiple aligned text blocks (columns)
      if (lineGapsCount >= 2) {
        tableScore += 2;
      } else if (lineGapsCount === 1) {
        tableScore += 1;
      }

      // If line font size is significantly larger than body text size, format it as a markdown heading
      const trimmedLine = lineText.trim();
      const wordCount = trimmedLine.split(/\s+/).length;
      const isShortLine =
        trimmedLine.length > 0 && trimmedLine.length < 100 && wordCount < 15;
      const doesNotEndWithPeriod = !trimmedLine.endsWith('.');

      if (
        lineFontSize >= bodyFontSize + 2.5 &&
        isShortLine &&
        doesNotEndWithPeriod
      ) {
        if (lineFontSize >= bodyFontSize + 5.5) {
          lineText = '## ' + lineText; // Major heading (H2)
        } else {
          lineText = '### ' + lineText; // Sub-heading (H3)
        }
      }

      pageText += lineText;

      // Determine separator for the next line based on vertical baseline gap
      if (j < linesMap.length - 1) {
        const currentY = line.y;
        const nextY = linesMap[j + 1].y;
        const verticalGap = currentY - nextY;

        if (verticalGap > 17) {
          pageText += '\n\n'; // Paragraph break
        } else {
          pageText += '\n'; // Line break within same paragraph
        }
      }
    }

    // If page score shows visual column structure patterns, mark it as a table page
    if (tableScore >= 3) {
      tablePages.push(i);
    }

    text += `[page ${i}]\n${pageText}\n\n`;
  }

  return { text: text.trim(), tablePages, numPages: doc.numPages };
};

const extractFromPdf = async (buffer: Buffer) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // `getDocument` spins up a worker that outlives the returned document, and
  // the document proxy has no teardown of its own — releasing it means holding
  // the loading task and destroying that, whether or not extraction succeeded.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  try {
    return await readPdfPages(await loadingTask.promise);
  } finally {
    await loadingTask.destroy();
  }
};

// Styles mammoth's default map discards, which would otherwise arrive as
// ordinary paragraphs.
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Caption'] => figcaption:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "r[style-name='Code'] => code",
  "r[style-name='Verbatim Char'] => code"
];

// DOCX: mammoth to HTML, with embedded images routed to the media sink.
// Without a sink they are dropped rather than inlined as base64.
const extractFromDocx = async (
  buffer: Buffer,
  context: ParseContext
): Promise<{ html: string }> => {
  const saveMedia = context.saveMedia;

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: DOCX_STYLE_MAP,
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!saveMedia) {
          return { src: '' };
        }
        try {
          const data = await image.readAsBuffer();
          const url = await saveMedia(data, image.contentType);
          return { src: url ?? '' };
        } catch (error) {
          logger.warn('[ParseService] Failed to extract an image from DOCX', {
            error: error instanceof Error ? error.message : String(error)
          });
          return { src: '' };
        }
      })
    }
  );

  // Unmapped styles and unsupported constructs land here.
  const warnings = result.messages.filter(
    (message) => message.type !== 'error'
  );
  if (warnings.length > 0) {
    logger.debug('[ParseService] DOCX conversion notes', {
      count: warnings.length,
      sample: warnings.slice(0, 5).map((message) => message.message)
    });
  }

  return { html: result.value.trim() };
};

// Markdown: the raw source doubles as the text projection, since it already
// carries `#` headings, pipe tables and list markers.
const extractFromMarkdown = async (
  buffer: Buffer
): Promise<{ content: string; html: string; meta: Record<string, string> }> => {
  const raw = buffer.toString('utf8');
  const { body, meta } = splitFrontMatter(raw);

  return {
    content: body.trim(),
    html: await markdownToHtml(body),
    meta
  };
};

// Plain text (txt/csv): no parsing needed, just decode UTF-8.
const extractFromPlainText = (buffer: Buffer): string => {
  return buffer.toString('utf8').trim();
};

// PPTX and XLSX are parsed structurally by our custom helpers.
// The raw plain text extraction below is kept for backward-compatibility.
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

// Fast plain text fallback for XLSX files. Reads and strips tags from the sharedStrings XML file,
// returning a single concatenated string of all cell values.
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

// Zip entries are addressed by full path, so an href like
// `../images/cover.jpg` has to be flattened against its document's directory.
const resolveZipPath = (fromPath: string, href: string): string => {
  const base = fromPath.split('/').slice(0, -1);
  const segments = decodeURIComponent(href.split('#')[0]).split('/');
  const resolved: string[] = [...base];

  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.join('/');
};

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
};

// Only the OPF package file knows the reading order (its <spine>). The zip's
// own entry order is arbitrary and can yield chapter 7 before chapter 1.
const extractFromEpub = async (
  buffer: Buffer,
  context: ParseContext
): Promise<{ html: string; title?: string; author?: string }> => {
  const zip = await JSZip.loadAsync(buffer);

  // META-INF/container.xml → the OPF package document.
  const containerXml = await zip
    .file('META-INF/container.xml')
    ?.async('string');
  const opfPath =
    containerXml?.match(/full-path="([^"]+)"/i)?.[1] ||
    Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf'));

  const opfXml = opfPath ? await zip.file(opfPath)?.async('string') : undefined;

  // Manifest: id → href/media-type. Spine: the ids in reading order.
  const manifest = new Map<string, { href: string; mediaType: string }>();
  const spine: string[] = [];
  let title: string | undefined;
  let author: string | undefined;

  if (opfXml) {
    for (const item of opfXml.match(/<item\s[^>]*\/?>/gi) || []) {
      const id = item.match(/\sid="([^"]+)"/i)?.[1];
      const href = item.match(/\shref="([^"]+)"/i)?.[1];
      const mediaType = item.match(/\smedia-type="([^"]+)"/i)?.[1] || '';
      if (id && href) {
        manifest.set(id, { href, mediaType });
      }
    }

    for (const itemref of opfXml.match(/<itemref\s[^>]*\/?>/gi) || []) {
      const idref = itemref.match(/\sidref="([^"]+)"/i)?.[1];
      if (idref) {
        spine.push(idref);
      }
    }

    title = opfXml
      .match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim();
    author = opfXml
      .match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim();
  }

  // Falls back to the archive listing for an EPUB with no usable spine.
  const documentPaths = spine
    .map((id) => manifest.get(id))
    .filter(
      (item): item is { href: string; mediaType: string } =>
        !!item && /x?html/i.test(item.mediaType || item.href)
    )
    .map((item) => resolveZipPath(opfPath || '', item.href));

  const paths =
    documentPaths.length > 0
      ? documentPaths
      : Object.keys(zip.files)
          .filter(
            (name) => !zip.files[name].dir && /\.(x?html|htm)$/i.test(name)
          )
          .sort();

  // Cached: EPUBs reuse the same asset across many documents.
  const mediaUrlByPath = new Map<string, string | null>();
  const storeImage = async (path: string): Promise<string | null> => {
    if (mediaUrlByPath.has(path)) {
      return mediaUrlByPath.get(path) ?? null;
    }

    let url: string | null = null;
    const file = zip.file(path);
    if (file && context.saveMedia) {
      try {
        const data = await file.async('nodebuffer');
        const extension = path.split('.').pop()?.toLowerCase() || '';
        url = await context.saveMedia(
          data,
          IMAGE_MIME_BY_EXTENSION[extension] || 'application/octet-stream'
        );
      } catch (error) {
        logger.warn('[ParseService] Failed to extract an image from EPUB', {
          path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    mediaUrlByPath.set(path, url);
    return url;
  };

  const limit = pLimit(4);
  const chapters = await Promise.all(
    paths.map((path) =>
      limit(async (): Promise<string> => {
        const file = zip.file(path);
        if (!file) {
          return '';
        }

        const xhtml = await file.async('string');
        const body = xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
        if (!body || !body.trim()) {
          return '';
        }

        const dom = new JSDOM(`<body>${body}</body>`);
        const { document } = dom.window;

        // Rewrite every in-archive image reference to its stored URL. Both the
        // HTML <img> and the SVG <image xlink:href> wrapper EPUBs use for cover
        // pages are handled.
        const images = Array.from(document.querySelectorAll('img, image'));
        for (const image of images) {
          const attribute = image.hasAttribute('src')
            ? 'src'
            : image.hasAttribute('xlink:href')
              ? 'xlink:href'
              : 'href';
          const href = image.getAttribute(attribute);
          if (!href || /^(https?:|data:)/i.test(href)) {
            continue;
          }

          const url = await storeImage(resolveZipPath(path, href));
          if (!url) {
            image.remove();
            continue;
          }

          const img = document.createElement('img');
          img.setAttribute('src', url);
          const alt = image.getAttribute('alt');
          if (alt) {
            img.setAttribute('alt', alt);
          }
          image.replaceWith(img);
        }

        return `<section class="epub-chapter">${document.body.innerHTML}</section>`;
      })
    )
  );

  return {
    html: chapters.filter(Boolean).join('\n'),
    title,
    author
  };
};

// ==========================================
// Format-Specific Unified Parsers
// ==========================================

// Tailwind classes cover the app's theme; the duplicated inline styles survive
// the `prose` reset and contexts that don't load the stylesheet.
const ELEMENT_STYLES: Record<string, { className: string; style?: string }> = {
  // `width: max-content` rather than `100%`: the table sits inside a
  // horizontally scrolling wrapper, and a table pinned to the wrapper's width
  // can never overflow it, so the columns would squeeze instead of scrolling.
  // `min-width: 100%` keeps narrow tables filling the column as before.
  table: {
    className: 'w-max min-w-full border-collapse border border-muted/50 my-4',
    style:
      'width: max-content; min-width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px;'
  },
  thead: { className: 'bg-muted/10' },
  tr: { className: 'even:bg-muted/5' },
  th: {
    className:
      'border border-muted/30 px-4 py-2 text-left font-bold text-sm text-foreground',
    style:
      'border: 1px solid rgba(128,128,128,0.3); padding: 8px 16px; text-align: left; font-weight: bold; background-color: rgba(128,128,128,0.1);'
  },
  td: {
    className: 'border border-muted/30 px-4 py-2 text-sm text-foreground/80',
    style: 'border: 1px solid rgba(128,128,128,0.2); padding: 8px 16px;'
  },
  pre: {
    className:
      'bg-muted/10 border border-muted/30 rounded-lg p-4 my-4 overflow-x-auto',
    style:
      'background-color: rgba(128,128,128,0.05); border: 1px solid rgba(128,128,128,0.2); padding: 16px; border-radius: 8px; margin: 16px 0; overflow-x: auto; font-family: monospace;'
  },
  blockquote: {
    className: 'border-l-4 border-muted/50 pl-4 italic my-4',
    style:
      'border-left: 4px solid rgba(128,128,128,0.35); padding-left: 16px; font-style: italic; margin: 16px 0;'
  },
  img: {
    className: 'max-w-full h-auto rounded-md my-4',
    style: 'max-width: 100%; height: auto; border-radius: 6px; margin: 16px 0;'
  },
  figure: { className: 'my-4', style: 'margin: 16px 0;' },
  figcaption: {
    className: 'text-xs text-muted-foreground mt-1',
    style: 'font-size: 12px; opacity: 0.7; margin-top: 4px;'
  }
};

const decorate = (element: Element, tag: string): void => {
  const decoration = ELEMENT_STYLES[tag];
  if (!decoration) {
    return;
  }
  const existing = element.getAttribute('class');
  element.setAttribute(
    'class',
    existing ? `${existing} ${decoration.className}` : decoration.className
  );
  if (decoration.style) {
    element.setAttribute('style', decoration.style);
  }
};

// DOCX, EPUB and fetched pages emit a flat run of <tr><td> with no <thead>, so
// the first row reads as data. Promote it when every cell has text.
const promoteTableHeader = (table: Element, document: Document): void => {
  if (table.querySelector('thead, th')) {
    return;
  }

  const firstRow = table.querySelector('tr');
  const cells = firstRow
    ? Array.from(firstRow.querySelectorAll(':scope > td'))
    : [];
  if (!firstRow || cells.length < 2) {
    return;
  }
  if (cells.some((cell) => !(cell.textContent || '').trim())) {
    return;
  }

  for (const cell of cells) {
    const header = document.createElement('th');
    header.innerHTML = cell.innerHTML;
    for (const attribute of Array.from(cell.attributes)) {
      header.setAttribute(attribute.name, attribute.value);
    }
    cell.replaceWith(header);
  }

  // The row sits inside <tbody>, but <thead> must be its sibling.
  const head = document.createElement('thead');
  firstRow.remove();
  head.appendChild(firstRow);
  table.insertBefore(head, table.firstChild);
};

// A wide table has to scroll without dragging the page with it. The scroll must
// live on a wrapper: putting `display: block` on the table itself would disable
// table layout, so the columns would shrink-wrap instead of sharing the width.
// Pairs with `ELEMENT_STYLES.table` — the wrapper only ever scrolls because the
// table inside it is `width: max-content`.
const wrapTableInScroller = (table: Element, document: Document): void => {
  if (table.parentElement?.classList.contains('table-scroll')) {
    return;
  }
  const scroller = document.createElement('div');
  scroller.setAttribute('class', 'table-scroll');
  scroller.setAttribute('style', 'max-width: 100%; overflow-x: auto;');
  table.replaceWith(scroller);
  scroller.appendChild(table);
};

// Word writes `<td><p>text</p></td>`, whose paragraph margins pad the cell out
// of shape.
const unwrapCellParagraphs = (document: Document): void => {
  for (const cell of Array.from(document.querySelectorAll('th, td'))) {
    const children = Array.from(cell.children);
    if (
      children.length === 1 &&
      children[0].tagName === 'P' &&
      !(cell.textContent || '').trim().includes('\n')
    ) {
      cell.innerHTML = children[0].innerHTML;
    }
  }
};

// The single choke point for reader HTML. Sanitizing first matters: the classes
// and styles added afterwards are ours and would otherwise be stripped.
const finalizeHtml = (html: string): string => {
  if (!html.trim()) {
    return '';
  }

  const dom = new JSDOM(`<body>${sanitizeSourceHtml(html)}</body>`);
  const { document } = dom.window;

  for (const table of Array.from(document.querySelectorAll('table'))) {
    promoteTableHeader(table, document);
    wrapTableInScroller(table, document);
  }
  unwrapCellParagraphs(document);

  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();

    if (tag === 'img') {
      // Media the sink declined to store would render as a broken image.
      if (!element.getAttribute('src')) {
        element.remove();
        continue;
      }
      element.setAttribute('loading', 'lazy');
    }

    if (tag === 'code' && element.parentElement?.tagName !== 'PRE') {
      // Inline code only — code inside <pre> inherits the block styling.
      element.setAttribute(
        'class',
        'bg-muted/10 rounded px-1.5 py-0.5 font-mono text-sm'
      );
      element.setAttribute(
        'style',
        'background-color: rgba(128,128,128,0.08); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em;'
      );
      continue;
    }

    decorate(element, tag);
  }

  return document.body.innerHTML;
};

// Renders an array of string cells as a Markdown table row
const renderMarkdownTable = (rows: string[][]): string => {
  if (rows.length === 0) return '';
  const maxCols = Math.max(...rows.map((r) => r.length));

  // Header row
  const header = rows[0];
  const headerCells = Array.from(
    { length: maxCols },
    (_, i) => header[i] || ''
  );
  const headerLine = '| ' + headerCells.join(' | ') + ' |';

  // Separator row
  const sepCells = Array.from({ length: maxCols }, () => '---');
  const sepLine = '|' + sepCells.join('|') + '|';

  // Data rows
  const bodyLines = rows.slice(1).map((row) => {
    const cells = Array.from({ length: maxCols }, (_, i) => row[i] || '');
    return '| ' + cells.join(' | ') + ' |';
  });

  return [headerLine, sepLine, ...bodyLines].join('\n');
};

// Converts blocks of tab-separated text into markdown table blocks
const convertTabsToMarkdownTables = (text: string): string => {
  const lines = text.split('\n');
  let result = '';
  let inTable = false;
  let tableRows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableRow = line.includes('\t');

    if (isTableRow) {
      const cells = line.split('\t').map((c) => c.trim());
      if (cells.filter(Boolean).length >= 2) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        tableRows.push(cells);
        continue;
      }
    }

    if (inTable) {
      result += renderMarkdownTable(tableRows) + '\n\n';
      inTable = false;
      tableRows = [];
    }

    result += line + '\n';
  }

  if (inTable && tableRows.length > 0) {
    result += renderMarkdownTable(tableRows) + '\n';
  }

  return result;
};

// Parses a PDF file, extracting text and wrapping each page's content inside an HTML div
// that preserves page boundaries for browser rendering.
const parsePdf = async (buffer: Buffer) => {
  // 1. Get raw local coordinate extraction and layout-detected table pages
  const {
    text: contentText,
    tablePages,
    numPages
  } = await extractFromPdf(buffer);
  let content = contentText;
  let isOcr = false;
  let ocrPageMap: Record<number, string> = {};

  // Check if average characters per page is below the threshold (scanned PDF detection)
  const textOnly = content.replace(/\[page \d+\]/g, '');
  const avgCharsPerPage = numPages > 0 ? textOnly.length / numPages : 0;
  const threshold = Number(env.OCR_CHARS_PER_PAGE_THRESHOLD);

  if (avgCharsPerPage < threshold) {
    logger.info(
      '[ParseService] PDF appears to be scanned — starting OCR fallback',
      {
        numPages,
        avgCharsPerPage: avgCharsPerPage.toFixed(1),
        threshold
      }
    );
    content = await runOcrOnPdf(buffer, numPages);
    isOcr = true;
  } else {
    // 2. If any pages contain tables, call Gemini to OCR only those specific pages!
    if (tablePages.length > 0) {
      logger.info(
        `[ParseService] Detected tables on pages: ${tablePages.join(', ')} — running targeted Gemini OCR for these pages`
      );
      try {
        ocrPageMap = await runOcrOnPdfPages(buffer, tablePages);
      } catch (err) {
        logger.error(
          '[ParseService] Targeted page OCR failed, falling back to local table layouts',
          err
        );
      }
    }
  }

  const pagePromises = content.split(/(?=\[page \d+\])/).map(async (p) => {
    const pageMarker = p.match(/^\[page (\d+)\]/);
    if (pageMarker) {
      const pageNum = Number(pageMarker[1]);
      const rest = p.replace(/^\[page \d+\]\s*/, '');

      // Use Gemini visual layout/OCR text if available for this page, otherwise use local coordinates
      const hasOcrText = ocrPageMap[pageNum] !== undefined;
      const pageText = hasOcrText ? ocrPageMap[pageNum] : rest;

      const isTablePage = tablePages.includes(pageNum);
      const hasTables = isTablePage || pageText.includes('\t');
      const hasHeadings = /(?:^|\n)#{2,3} /.test(pageText);

      // Convert tab-separated layouts to styled tables if OCR is active or tables/headings are detected
      if (isOcr || hasOcrText || hasTables || hasHeadings) {
        const markdownContent = convertTabsToMarkdownTables(pageText);
        const styledHtml = finalizeHtml(await markdownToHtml(markdownContent));
        return `<div class="pdf-page mb-6 border-b border-dashed pb-4 border-muted/50"><div class="text-xs font-bold text-muted-foreground mb-2">Page ${pageNum}</div>${styledHtml}</div>`;
      } else {
        const paragraphsHtml = pageText
          .split('\n\n')
          .filter((para) => para.trim().length > 0)
          .map(
            (para) => `<p>${escapeHtml(para.replace(/\n/g, ' ').trim())}</p>`
          )
          .join('');
        return `<div class="pdf-page mb-6 border-b border-dashed pb-4 border-muted/50"><div class="text-xs font-bold text-muted-foreground mb-2">Page ${pageNum}</div>${paragraphsHtml}</div>`;
      }
    }

    const hasTables = p.includes('\t');
    const hasHeadings = /(?:^|\n)#{2,3} /.test(p);
    if (isOcr || hasTables || hasHeadings) {
      const markdownContent = convertTabsToMarkdownTables(p);
      return finalizeHtml(await markdownToHtml(markdownContent));
    } else {
      return p
        .split('\n\n')
        .filter((para) => para.trim().length > 0)
        .map((para) => `<p>${escapeHtml(para.replace(/\n/g, ' ').trim())}</p>`)
        .join('');
    }
  });

  const pagesHtml = (await Promise.all(pagePromises)).join('');

  // Update raw content string with the visual table markdown from Gemini
  // so that vector search embeddings are built from high-quality tables
  if (Object.keys(ocrPageMap).length > 0) {
    const updatedPages = content.split(/(?=\[page \d+\])/).map((page) => {
      const match = page.match(/^\[page (\d+)\]/);
      if (match) {
        const pageNum = Number(match[1]);
        if (ocrPageMap[pageNum]) {
          return `[page ${pageNum}]\n${ocrPageMap[pageNum]}`;
        }
      }
      return page;
    });
    content = updatedPages.join('\n\n');
  }

  return {
    content,
    // Badged by the reader as "PDF · 14 pages".
    pageCount: numPages,
    structuredContent: {
      type: 'document',
      html: pagesHtml
    }
  };
};

// Document HTML plus the text projection of that same HTML, so table cells stay
// in their rows for the embeddings.
const parseDocx = async (buffer: Buffer, context: ParseContext) => {
  const res = await extractFromDocx(buffer, context);
  const html = finalizeHtml(res.html);
  return {
    content: htmlToText(html),
    structuredContent: {
      type: 'document',
      html
    }
  };
};

// Parses a Markdown file. The markdown itself is the text projection; the HTML
// is the rendered view.
const parseMarkdownFile = async (buffer: Buffer) => {
  const res = await extractFromMarkdown(buffer);
  return {
    content: res.content,
    title: res.meta.title,
    author: res.meta.author,
    structuredContent: {
      type: 'document',
      html: finalizeHtml(res.html)
    }
  };
};

// Structured slide JSON plus a markdown projection, so passages keep their
// slide heading.
const parsePptxFile = async (buffer: Buffer) => {
  const slides = await parsePptxSlides(buffer);

  const content = slides
    .map((slide) =>
      [
        `## Slide ${slide.slideNumber}: ${slide.title}`,
        ...slide.bullets.map((bullet) => `- ${bullet}`)
      ].join('\n')
    )
    .join('\n\n');

  return {
    content: content.trim() || (await extractFromPptx(buffer)),
    structuredContent: {
      type: 'slides',
      slides
    }
  };
};

// The text projection for XLSX and CSV: a cell value only means something next
// to its column header, which a flat dump of shared strings loses.
const sheetsToMarkdown = (
  sheets: { name: string; headers: string[]; rows: string[][] }[]
): string =>
  sheets
    .map((sheet) =>
      `## ${sheet.name}\n\n${renderMarkdownTable([sheet.headers, ...sheet.rows])}`.trim()
    )
    .join('\n\n')
    .trim();

// Parses an XLSX file into structured sheets JSON plus a markdown projection.
const parseXlsxFile = async (buffer: Buffer) => {
  const sheets = await parseXlsxSheets(buffer);
  return {
    content: sheetsToMarkdown(sheets) || (await extractFromXlsx(buffer)),
    structuredContent: {
      type: 'sheets',
      sheets
    }
  };
};

// Parses an EPUB file into reading-order chapters and document HTML.
const parseEpubFile = async (buffer: Buffer, context: ParseContext) => {
  const res = await extractFromEpub(buffer, context);
  const html = finalizeHtml(res.html);
  return {
    content: htmlToText(html),
    // Applied by the worker only if the uploader left the defaults.
    title: res.title,
    author: res.author,
    structuredContent: {
      type: 'document',
      html
    }
  };
};

// Decodes a plain text file (TXT) and wraps its paragraphs into HTML <p> tags.
const parseTxt = async (buffer: Buffer) => {
  const content = extractFromPlainText(buffer);
  const textHtml = content
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return {
    content,
    structuredContent: {
      type: 'document',
      html: finalizeHtml(textHtml)
    }
  };
};

// RFC 4180 quoting: a quoted field can contain commas, newlines and doubled
// quotes. Splitting on every comma tears `"Smith, John"` into two columns.
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Close on CR, LF or CRLF, ignoring a trailing newline's empty row.
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) {
        rows.push(row);
      }
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) {
    rows.push(row);
  }

  return rows.map((cells) => cells.map((cell) => cell.trim()));
};

// Parses a CSV file into sheet-like structured JSON data.
const parseCsvFile = async (buffer: Buffer) => {
  const rows = parseCsv(extractFromPlainText(buffer));
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);

  const sheets = [{ name: 'CSV Data', headers, rows: dataRows }];

  return {
    content: sheetsToMarkdown(sheets),
    structuredContent: {
      type: 'sheets',
      sheets
    }
  };
};

export type ParseResult = {
  content: string;
  structuredContent: any;
  // Carried by the file itself; only fills fields the uploader left blank.
  title?: string;
  author?: string;
  // Page count, where the format has pages at all (PDF today).
  pageCount?: number;
};

// Main unified parser function. Routes the binary buffer to the appropriate format parser
// based on the file format string, and returns content (for embeddings) and structuredContent.
const parse = async (
  format: string,
  buffer: Buffer,
  context: ParseContext = {}
): Promise<ParseResult> => {
  switch (format) {
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer, context);
    case 'md':
      return parseMarkdownFile(buffer);
    case 'pptx':
      return parsePptxFile(buffer);
    case 'xlsx':
      return parseXlsxFile(buffer);
    case 'epub':
      return parseEpubFile(buffer, context);
    case 'txt':
      return parseTxt(buffer);
    case 'csv':
      return parseCsvFile(buffer);
    default:
      throw new Error(`Unsupported format for parsing: ${format}`);
  }
};

export default { parse, finalizeHtml, markdownToHtml };
