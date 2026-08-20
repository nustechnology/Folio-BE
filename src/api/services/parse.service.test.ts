import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import ParseService, {
  hasAlignedColumnRun
} from '~/api/services/parse.service';
import type { ColumnEdges } from '~/api/services/parse.service';

// `vi.hoisted` so the spies exist before the mock factory runs — the factory is
// lifted above the imports, which is also what lets the import of the service
// under test stay static and therefore type-checked by `yarn typecheck`.
const ocr = vi.hoisted(() => ({
  runOcrOnPdf: vi.fn(),
  runOcrOnPdfPages: vi.fn()
}));

vi.mock('~/api/services/ocr.service', () => ({
  runOcrOnPdf: ocr.runOcrOnPdf,
  runOcrOnPdfPages: ocr.runOcrOnPdfPages,
  OcrError: class OcrError extends Error {}
}));

// One line's columns as [start, end] pairs, in left-to-right order. The
// leftmost column carries a null start, which is what readPdfPages emits for
// it — every line opens at the left margin, so that edge proves nothing.
const line = (...columns: [number | null, number][]): ColumnEdges[] =>
  columns.map(([start, end]) => ({ start, end }));

describe('hasAlignedColumnRun — real tables', () => {
  it('accepts left-aligned columns holding the same start', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 150], [220, 330], [400, 480]),
        line([null, 162], [220, 336], [400, 471]),
        line([null, 141], [220, 328], [400, 476])
      ])
    ).toBe(true);
  });

  // Coordinates lifted from a generated PDF whose amounts are right-aligned:
  // the starts wander by up to 14pt as the digit count changes, while the ends
  // hold to a tenth of a point.
  it('accepts right-aligned numbers, whose starts move but ends hold', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 112.6], [357.2, 380.0], [485.5, 520]),
        line([null, 132.0], [355.0, 380.0], [483.9, 520]),
        line([null, 166.5], [368.9, 379.9], [489.4, 520])
      ])
    ).toBe(true);
  });

  it('tolerates sub-point drift between rows', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 150], [220, 330], [400, 480]),
        line([null, 150], [222, 331], [401, 479]),
        line([null, 150], [219, 329], [398, 481])
      ])
    ).toBe(true);
  });

  it('finds a table that starts partway down the page', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 300]), // heading
        line([null, 130], [137, 540]), // prose with one stretched gap
        line([null, 150], [220, 330], [400, 480]),
        line([null, 162], [221, 336], [399, 471]),
        line([null, 141], [220, 328], [400, 476])
      ])
    ).toBe(true);
  });

  it('ignores a stray wide column in one row', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 150], [220, 330], [400, 480]),
        line([null, 162], [220, 336], [400, 471], [510, 560]),
        line([null, 141], [220, 328], [400, 476])
      ])
    ).toBe(true);
  });
});

describe('hasAlignedColumnRun — prose that must not reach the provider', () => {
  // Justification holds the right margin at 540 on every line, but the gaps it
  // stretches to get there fall wherever the words happen to end.
  it('rejects justified text, whose interior gaps land at unrelated x', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 288], [340, 421], [455, 540]),
        line([null, 201], [255, 390], [430, 540]),
        line([null, 341], [389, 460], [500, 540])
      ])
    ).toBe(false);
  });

  // Both edges of a justified two-column article are stable — the gutter and
  // the right margin — so only the column count separates it from a table.
  it('rejects a page set in two justified columns', () => {
    const twoUp = line([null, 290], [306, 540]);
    expect(hasAlignedColumnRun([twoUp, twoUp, twoUp, twoUp, twoUp])).toBe(
      false
    );
  });

  it('rejects table-of-contents dot leaders, even at equal number widths', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 124], [520, 526]),
        line([null, 129], [520, 526]),
        line([null, 143], [520, 526]),
        line([null, 113], [520, 526])
      ])
    ).toBe(false);
  });

  it('rejects a lone footer line', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 300]),
        line([null, 300]),
        line([null, 90], [300, 340], [500, 520])
      ])
    ).toBe(false);
  });

  it('rejects an aligned pair too short to be a table', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 150], [220, 330], [400, 480]),
        line([null, 162], [220, 336], [400, 471])
      ])
    ).toBe(false);
  });

  it('rejects a page with no wide gaps at all', () => {
    expect(
      hasAlignedColumnRun([
        line([null, 540]),
        line([null, 512]),
        line([null, 538]),
        line([null, 400])
      ])
    ).toBe(false);
  });
});

// Draws the four page shapes the gate has to tell apart, so the assertion below
// runs on coordinates pdfjs actually produces rather than on hand-written ones.
const buildFixturePdf = async (): Promise<Buffer> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10;
  const width = (text: string) => font.widthOfTextAtSize(text, size);
  const draw = (page: PDFPage, text: string, x: number, y: number) =>
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });

  // Page 1 — prose.
  const prose = doc.addPage([612, 792]);
  [
    'The quarterly review covers operations across every region and',
    'summarises the performance of each business unit in turn. Revenue',
    'grew steadily through the period while costs remained flat, and',
    'the outlook for the coming year is described in the appendix.',
    'Further commentary on the segment results appears below, with',
    'the detailed reconciliation deferred to the notes that follow.'
  ].forEach((text, i) => draw(prose, text, 72, 700 - i * 14));

  // Page 2 — left-aligned table.
  const leftTable = doc.addPage([612, 792]);
  (
    [
      ['Region', 'Manager', 'Status'],
      ['North', 'Alice Chen', 'Active'],
      ['South', 'Bo Nguyen', 'Active'],
      ['East', 'Kim Rivera', 'Pending'],
      ['West', 'Sam Osei', 'Active']
    ] as [string, string, string][]
  ).forEach((row, i) => {
    const y = 700 - i * 16;
    draw(leftTable, row[0], 72, y);
    draw(leftTable, row[1], 220, y);
    draw(leftTable, row[2], 400, y);
  });

  // Page 3 — the case starts-only detection missed: right-aligned amounts.
  const rightTable = doc.addPage([612, 792]);
  (
    [
      ['Line item', 'Units', 'Amount'],
      ['Subscriptions', '1,204', '482,900'],
      ['Professional services', '88', '12,340'],
      ['Hardware resale', '9,431', '1,204,556'],
      ['Support contracts', '212', '77,010'],
      ['Training', '17', '4,220']
    ] as [string, string, string][]
  ).forEach((row, i) => {
    const y = 700 - i * 16;
    draw(rightTable, row[0], 72, y);
    draw(rightTable, row[1], 380 - width(row[1]), y);
    draw(rightTable, row[2], 520 - width(row[2]), y);
  });

  // Page 4 — table of contents.
  const toc = doc.addPage([612, 792]);
  (
    [
      ['Introduction', '1'],
      ['Methodology', '7'],
      ['Regional results', '4'],
      ['Appendix', '9']
    ] as [string, string][]
  ).forEach(([title, page], i) => {
    const y = 700 - i * 16;
    draw(toc, title, 72, y);
    draw(toc, page, 520, y);
  });

  return Buffer.from(await doc.save());
};

describe('parsePdf — which pages reach the OCR provider', () => {
  beforeEach(() => {
    ocr.runOcrOnPdf.mockReset();
    ocr.runOcrOnPdfPages.mockReset();
    ocr.runOcrOnPdfPages.mockResolvedValue({});
  });

  it('sends both table pages and neither prose nor contents', async () => {
    const buffer = await buildFixturePdf();

    await ParseService.parse('pdf', buffer);

    expect(ocr.runOcrOnPdf).not.toHaveBeenCalled();
    expect(ocr.runOcrOnPdfPages).toHaveBeenCalledTimes(1);
    expect(ocr.runOcrOnPdfPages.mock.calls[0][1]).toEqual([2, 3]);
  }, 60000);

  it('keeps the local text for a page the provider returns empty', async () => {
    const buffer = await buildFixturePdf();
    ocr.runOcrOnPdfPages.mockResolvedValue({
      2: '',
      3: '| a | b |\n| - | - |'
    });

    const result = await ParseService.parse('pdf', buffer);

    // Page 2's row labels survive rather than being blanked by the empty reply.
    expect(result.content).toContain('Alice Chen');
    expect(result.structuredContent.html).toContain('Alice Chen');
  }, 60000);
});
