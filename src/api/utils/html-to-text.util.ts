// HTML → Markdown-ish text, used to build `Source.content` (what gets embedded)
// from the same HTML the reader shows. Keeps the structure a naive
// `textContent` discards: headings become `#` lines, which normalization turns
// into passage heading paths, and tables become pipe rows rather than a run of
// cells with no column to belong to.
import { JSDOM } from 'jsdom';

// Collapse HTML whitespace without touching the newlines inserted below.
const collapseInline = (text: string): string =>
  text.replace(/[\t\f\v ]*\r?\n[\t\f\v ]*/g, ' ').replace(/[ \t]+/g, ' ');

const renderCells = (row: Element): string[] =>
  Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
    // A pipe inside a cell would break the row apart when the text is read back.
    collapseInline(cell.textContent || '')
      .trim()
      .replace(/\|/g, '\\|')
  );

const renderTable = (table: Element): string => {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) {
    return '';
  }

  const grid = rows.map(renderCells).filter((cells) => cells.length > 0);
  if (grid.length === 0) {
    return '';
  }

  const columnCount = Math.max(...grid.map((cells) => cells.length));
  const toLine = (cells: string[]): string =>
    `| ${Array.from({ length: columnCount }, (_, i) => cells[i] ?? '').join(' | ')} |`;

  const separator = `|${Array.from({ length: columnCount }, () => '---').join('|')}|`;
  return [toLine(grid[0]), separator, ...grid.slice(1).map(toLine)].join('\n');
};

// Block elements are padded with blank lines and normalized at the end, so
// nesting can't produce runaway gaps.
const renderNode = (node: Node, listPrefix?: string): string => {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return collapseInline(node.textContent || '');
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) {
    return '';
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = () =>
    Array.from(element.childNodes)
      .map((child) => renderNode(child))
      .join('');

  switch (tag) {
    case 'script':
    case 'style':
    case 'noscript':
      return '';

    case 'br':
      return '\n';

    case 'hr':
      return '\n\n---\n\n';

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n\n${'#'.repeat(Number(tag[1]))} ${children().trim()}\n\n`;

    case 'img': {
      const alt = element.getAttribute('alt')?.trim();
      const title = element.getAttribute('title')?.trim();
      const label = alt || title;
      // The caption is often the only description of a figure we can embed.
      return label ? `\n\n[Image: ${label}]\n\n` : '';
    }

    case 'pre':
      return `\n\n\`\`\`\n${(element.textContent || '').trim()}\n\`\`\`\n\n`;

    case 'blockquote':
      return `\n\n${children()
        .trim()
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n')}\n\n`;

    case 'table':
      return `\n\n${renderTable(element)}\n\n`;

    // Handled by renderTable; reaching them here means a stray fragment.
    case 'thead':
    case 'tbody':
    case 'tfoot':
    case 'tr':
      return '';

    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol';
      const items = Array.from(element.children).filter(
        (child) => child.tagName.toLowerCase() === 'li'
      );
      const rendered = items
        .map((item, index) =>
          renderNode(item, ordered ? `${index + 1}. ` : '- ')
        )
        .join('');
      return `\n\n${rendered.trim()}\n\n`;
    }

    case 'li': {
      const prefix = listPrefix ?? '- ';
      const body = children().trim();
      if (!body) {
        return '';
      }
      // Indent wrapped lines (and nested lists) under the marker.
      const [first, ...rest] = body.split('\n');
      return [
        `${prefix}${first}`,
        ...rest.map((line) => (line ? `  ${line}` : line))
      ]
        .join('\n')
        .concat('\n');
    }

    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'figure':
    case 'figcaption':
    case 'dl':
    case 'dt':
    case 'dd':
    case 'caption':
      return `\n\n${children().trim()}\n\n`;

    default:
      return children();
  }
};

// Takes a document fragment, not a full page.
export const htmlToText = (html: string): string => {
  if (!html.trim()) {
    return '';
  }

  const dom = new JSDOM(`<body>${html}</body>`);
  const text = renderNode(dom.window.document.body);

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export default { htmlToText };
