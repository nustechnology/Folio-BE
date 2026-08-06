import JSZip from 'jszip';
import mammoth from 'mammoth';
import pLimit from 'p-limit';
import { marked } from 'marked';

import { runOcrOnPdf, runOcrOnPdfPages } from '~/api/services/ocr.service';
import { env } from '~/config/enviroment';
import logger from '~/config/logger';

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
    const tMatches = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    for (const match of tMatches) {
      const text = match.replace(/<[^>]+>/g, '');
      sharedStrings.push(text);
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

    // Each cell in a sheet is represented by a <c> tag.
    // Permissive match for cells: support both normal and self-closing tags.
    const cMatches =
      xml.match(/<c\s+[^>]+>([\s\S]*?)<\/c>/gi) ||
      xml.match(/<c\s+[^>]+\/>/gi) ||
      [];
    for (const cMatch of cMatches) {
      // Cell reference e.g. r="A1" maps to column "A", row "1"
      const rMatch =
        cMatch.match(/r="([A-Z]+)(\d+)"/i) ||
        cMatch.match(/r='([A-Z]+)(\d+)'/i);
      if (!rMatch) continue;
      const col = rMatch[1].toUpperCase();
      const row = Number(rMatch[2]);

      // t="s" indicates the cell's value is stored in sharedStrings.xml (shared string index).
      const tMatch =
        cMatch.match(/t="([^"]+)"/i) || cMatch.match(/t='([^']+)'/i);
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
          value = valStr;
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
const extractFromPdf = async (
  buffer: Buffer
): Promise<{ text: string; tablePages: number[] }> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

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

  return { text: text.trim(), tablePages };
};

// DOCX: mammoth converts the document to plain text and HTML.
const extractFromDocx = async (
  buffer: Buffer
): Promise<{ content: string; html: string }> => {
  const rawResult = await mammoth.extractRawText({ buffer });
  const htmlResult = await mammoth.convertToHtml({ buffer });
  return {
    content: rawResult.value.trim(),
    html: htmlResult.value.trim()
  };
};

// Markdown: parsed to an mdast tree (remark supports GitHub-flavored markdown) for raw text,
// and formatted to clean HTML.
const extractFromMarkdown = async (
  buffer: Buffer
): Promise<{ content: string; html: string }> => {
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  const { toString } = await import('mdast-util-to-string');

  const text = buffer.toString('utf8');
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text);
  const content = toString(tree as never).trim();

  const html = (await marked.parse(text)) as string;

  return { content, html };
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

// Unzips the EPUB archive, filters for XHTML/HTML files, and extracts both raw, tag-stripped
// content and the raw HTML body content. Uses pLimit to process files with a concurrency limit.
const extractFromEpub = async (
  buffer: Buffer
): Promise<{ content: string; html: string }> => {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter(
    (file) => !file.dir && /\.(x?html|htm)$/i.test(file.name)
  );

  const limit = pLimit(4);
  const rawParts = await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const xml = await entry.async('string');
        return stripTags(xml);
      })
    )
  );

  const htmlParts = await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const xml = await entry.async('string');
        const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? bodyMatch[1] : xml;
      })
    )
  );

  return {
    content: rawParts.filter(Boolean).join('\n').trim(),
    html: htmlParts.filter(Boolean).join('\n').trim()
  };
};

// ==========================================
// Format-Specific Unified Parsers
// ==========================================

// Injects Tailwind styles and inline CSS rules into tables and code blocks to render beautifully
const injectStyles = (html: string): string => {
  let styled = html
    .replace(
      /<table>/g,
      '<table class="w-full border-collapse border border-muted/50 my-4" style="width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px;">'
    )
    .replace(/<thead>/g, '<thead class="bg-muted/10">')
    .replace(/<tr>/g, '<tr class="even:bg-muted/5">')
    .replace(
      /<th>/g,
      '<th class="border border-muted/30 px-4 py-2 text-left font-bold text-sm text-foreground" style="border: 1px solid rgba(128,128,128,0.3); padding: 8px 16px; text-align: left; font-weight: bold; background-color: rgba(128,128,128,0.1);">'
    )
    .replace(
      /<td>/g,
      '<td class="border border-muted/30 px-4 py-2 text-sm text-foreground/80" style="border: 1px solid rgba(128,128,128,0.2); padding: 8px 16px;">'
    );

  // Style block code (<pre><code class="xyz">)
  styled = styled.replace(
    /<pre><code class="([^"]*)">/g,
    '<pre class="bg-muted/10 border border-muted/30 rounded-lg p-4 my-4 overflow-x-auto" style="background-color: rgba(128,128,128,0.05); border: 1px solid rgba(128,128,128,0.2); padding: 16px; border-radius: 8px; margin: 16px 0; overflow-x: auto; font-family: monospace;"><code class="font-mono text-sm $1" style="font-family: monospace;">'
  );
  // Style block code (<pre><code> with no class)
  styled = styled.replace(
    /<pre><code>/g,
    '<pre class="bg-muted/10 border border-muted/30 rounded-lg p-4 my-4 overflow-x-auto" style="background-color: rgba(128,128,128,0.05); border: 1px solid rgba(128,128,128,0.2); padding: 16px; border-radius: 8px; margin: 16px 0; overflow-x: auto; font-family: monospace;"><code class="font-mono text-sm" style="font-family: monospace;">'
  );

  // Style inline code (<code>)
  styled = styled.replace(
    /<code>/g,
    '<code class="bg-muted/10 rounded px-1.5 py-0.5 font-mono text-sm" style="background-color: rgba(128,128,128,0.08); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em;">'
  );

  return styled;
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
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const numPages = doc.numPages;

  // 1. Get raw local coordinate extraction and layout-detected table pages
  const { text: contentText, tablePages } = await extractFromPdf(buffer);
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
        const parsedHtml = await marked.parse(markdownContent);
        const styledHtml = injectStyles(parsedHtml);
        return `<div class="pdf-page mb-6 border-b border-dashed pb-4 border-muted/50"><div class="text-xs font-bold text-muted-foreground mb-2">Page ${pageNum}</div>${styledHtml}</div>`;
      } else {
        const paragraphsHtml = pageText
          .split('\n\n')
          .filter((para) => para.trim().length > 0)
          .map((para) => `<p>${para.replace(/\n/g, ' ').trim()}</p>`)
          .join('');
        return `<div class="pdf-page mb-6 border-b border-dashed pb-4 border-muted/50"><div class="text-xs font-bold text-muted-foreground mb-2">Page ${pageNum}</div>${paragraphsHtml}</div>`;
      }
    }

    const hasTables = p.includes('\t');
    const hasHeadings = /(?:^|\n)#{2,3} /.test(p);
    if (isOcr || hasTables || hasHeadings) {
      const markdownContent = convertTabsToMarkdownTables(p);
      const parsedHtml = await marked.parse(markdownContent);
      const styledHtml = injectStyles(parsedHtml);
      return styledHtml;
    } else {
      return p
        .split('\n\n')
        .filter((para) => para.trim().length > 0)
        .map((para) => `<p>${para.replace(/\n/g, ' ').trim()}</p>`)
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
    structuredContent: {
      type: 'document',
      html: pagesHtml
    }
  };
};

// Parses a DOCX file into plain text (for embeddings) and document-type HTML structure.
const parseDocx = async (buffer: Buffer) => {
  const res = await extractFromDocx(buffer);
  return {
    content: res.content,
    structuredContent: {
      type: 'document',
      html: injectStyles(res.html)
    }
  };
};

// Parses a Markdown file into plain text (AST-based) and HTML (using the marked renderer).
const parseMarkdownFile = async (buffer: Buffer) => {
  const res = await extractFromMarkdown(buffer);
  return {
    content: res.content,
    structuredContent: {
      type: 'document',
      html: injectStyles(res.html)
    }
  };
};

// Parses a PPTX file, providing a tag-stripped text fallback along with structured slide JSON.
const parsePptxFile = async (buffer: Buffer) => {
  const content = await extractFromPptx(buffer);
  const slides = await parsePptxSlides(buffer);
  return {
    content,
    structuredContent: {
      type: 'slides',
      slides
    }
  };
};

// Parses an XLSX file, returning tag-stripped text fallback and structured sheets JSON.
const parseXlsxFile = async (buffer: Buffer) => {
  const content = await extractFromXlsx(buffer);
  const sheets = await parseXlsxSheets(buffer);
  return {
    content,
    structuredContent: {
      type: 'sheets',
      sheets
    }
  };
};

// Parses an EPUB file into concatenated plain text and document HTML.
const parseEpubFile = async (buffer: Buffer) => {
  const res = await extractFromEpub(buffer);
  return {
    content: res.content,
    structuredContent: {
      type: 'document',
      html: injectStyles(res.html)
    }
  };
};

// Decodes a plain text file (TXT) and wraps its paragraphs into HTML <p> tags.
const parseTxt = async (buffer: Buffer) => {
  const content = extractFromPlainText(buffer);
  const textHtml = content
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.trim().replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return {
    content,
    structuredContent: {
      type: 'document',
      html: injectStyles(textHtml)
    }
  };
};

// Parses a CSV file, splitting rows and columns to return sheet-like structured JSON data.
const parseCsvFile = async (buffer: Buffer) => {
  const content = extractFromPlainText(buffer);
  const rows = content.split('\n').map((line) => line.split(','));
  let headers: string[] = [];
  let finalRows: string[][] = [];
  if (rows.length > 0) {
    headers = rows[0];
    finalRows = rows.slice(1);
  }
  return {
    content,
    structuredContent: {
      type: 'sheets',
      sheets: [
        {
          name: 'CSV Data',
          headers,
          rows: finalRows
        }
      ]
    }
  };
};

// Main unified parser function. Routes the binary buffer to the appropriate format parser
// based on the file format string, and returns content (for embeddings) and structuredContent.
const parse = async (
  format: string,
  buffer: Buffer
): Promise<{ content: string; structuredContent: any }> => {
  switch (format) {
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'md':
      return parseMarkdownFile(buffer);
    case 'pptx':
      return parsePptxFile(buffer);
    case 'xlsx':
      return parseXlsxFile(buffer);
    case 'epub':
      return parseEpubFile(buffer);
    case 'txt':
      return parseTxt(buffer);
    case 'csv':
      return parseCsvFile(buffer);
    default:
      throw new Error(`Unsupported format for parsing: ${format}`);
  }
};

export default { parse, injectStyles };
