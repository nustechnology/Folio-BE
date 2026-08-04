import JSZip from 'jszip';
import mammoth from 'mammoth';
import pLimit from 'p-limit';
import { marked } from 'marked';

// Rough tag stripper for XML-based containers (PPTX slides, XLSX strings,
// EPUB documents) — good enough to pull readable text without a full HTML parser.
const stripTags = (xml: string): string => {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const parseXlsxSheets = async (
  buffer: Buffer
): Promise<{ name: string; headers: string[]; rows: string[][] }[]> => {
  const zip = await JSZip.loadAsync(buffer);

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

    // Permissive match for cells: support both normal and self-closing tags
    const cMatches =
      xml.match(/<c\s+[^>]+>([\s\S]*?)<\/c>/gi) ||
      xml.match(/<c\s+[^>]+\/>/gi) ||
      [];
    for (const cMatch of cMatches) {
      const rMatch =
        cMatch.match(/r="([A-Z]+)(\d+)"/i) ||
        cMatch.match(/r='([A-Z]+)(\d+)'/i);
      if (!rMatch) continue;
      const col = rMatch[1].toUpperCase();
      const row = Number(rMatch[2]);

      const tMatch =
        cMatch.match(/t="([^"]+)"/i) || cMatch.match(/t='([^']+)'/i);
      const isSharedString = tMatch && tMatch[1] === 's';

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

    const sortedCols = Array.from(colLetters).sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });

    const rowNumbers = Object.keys(rowsMap)
      .map(Number)
      .sort((a, b) => a - b);
    if (rowNumbers.length === 0) continue;

    const headers = sortedCols;
    const rows: string[][] = [];

    for (const rNum of rowNumbers) {
      const rowData = sortedCols.map((col) => rowsMap[rNum][col] || '');
      rows.push(rowData);
    }

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

const parsePptxSlides = async (
  buffer: Buffer
): Promise<{ slideNumber: number; title: string; bullets: string[] }[]> => {
  const zip = await JSZip.loadAsync(buffer);
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

    const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
    let slideTitle = '';
    const bullets: string[] = [];

    for (const shape of shapes) {
      const isTitle =
        shape.includes('type="title"') ||
        shape.includes('type="ctrTitle"') ||
        shape.includes('type="subTitle"');

      const paragraphs = shape.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
      for (const para of paragraphs) {
        const textRuns = para.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
        const paraText = textRuns
          .map((run) => run.replace(/<[^>]+>/g, ''))
          .join('')
          .trim();

        if (paraText) {
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

const parsePdf = async (buffer: Buffer) => {
  const content = await extractFromPdf(buffer);
  const pagesHtml = content
    .split('\n\n')
    .map((p) => {
      const pageMarker = p.match(/^\[page (\d+)\]/);
      if (pageMarker) {
        const pageNum = pageMarker[1];
        const rest = p.replace(/^\[page \d+\]\s*/, '');
        return `<div class="pdf-page mb-6 border-b border-dashed pb-4 border-muted/50"><div class="text-xs font-bold text-muted-foreground mb-2">Page ${pageNum}</div><p>${rest.replace(/\n/g, '<br/>')}</p></div>`;
      }
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('');
  return {
    content,
    structuredContent: {
      type: 'document',
      html: pagesHtml
    }
  };
};

const parseDocx = async (buffer: Buffer) => {
  const res = await extractFromDocx(buffer);
  return {
    content: res.content,
    structuredContent: {
      type: 'document',
      html: res.html
    }
  };
};

const parseMarkdownFile = async (buffer: Buffer) => {
  const res = await extractFromMarkdown(buffer);
  return {
    content: res.content,
    structuredContent: {
      type: 'document',
      html: res.html
    }
  };
};

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

const parseEpubFile = async (buffer: Buffer) => {
  const res = await extractFromEpub(buffer);
  return {
    content: res.content,
    structuredContent: {
      type: 'document',
      html: res.html
    }
  };
};

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
      html: textHtml
    }
  };
};

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

export default { parse };
