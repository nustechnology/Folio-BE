// Normalization: turns the raw extracted text into ordered "blocks" (paragraphs)
// tagged with a heading path. The heading path is the key signal the semantic
// chunker uses to avoid merging across section boundaries, and it is later
// projected onto Passage locators so citations stay resolvable.
export type Block = {
  text: string;
  headingPath: string[];
  order: number;
};

// A plain-text line is only treated as a heading with strong evidence: it is
// short, has no sentence-ending punctuation, is not a list item, AND is
// followed by a blank line. This stops one-liners inside a paragraph and list
// items from being misclassified as headings (which would otherwise create a
// new single-unit section for every short line). Markdown `#` headings are
// handled separately below and are always recognized.
const MAX_HEADING_LENGTH = 80;
const MAX_HEURISTIC_HEADING_DEPTH = 3;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

const looksLikeHeading = (
  line: string,
  nextLine: string | undefined
): boolean => {
  if (line.length > MAX_HEADING_LENGTH) {
    return false;
  }
  if (/[.!?:;,]$/.test(line)) {
    return false;
  }
  if (LIST_MARKER.test(line)) {
    return false;
  }
  if (nextLine === undefined || nextLine.trim() !== '') {
    return false;
  }
  return true;
};

export const normalizeToBlocks = (content: string): Block[] => {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let headingPath: string[] = [];
  let current: string[] = [];
  let order = 0;

  // Close the current paragraph into a block (if non-empty) and reset.
  const flush = () => {
    const text = current.join(' ').trim();
    if (text) {
      blocks.push({ text, headingPath: [...headingPath], order: order++ });
    }
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flush(); // blank line = paragraph boundary
      continue;
    }

    // Markdown heading (#, ##, ...) — resets the heading path to that level.
    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownHeading) {
      flush();
      const level = markdownHeading[1].length;
      headingPath = headingPath.slice(0, level - 1).concat(markdownHeading[2]);
      continue;
    }

    // Plain-text heading heuristic — requires strong evidence. The heading text
    // is also kept in the current paragraph so its content reaches a block
    // instead of being dropped, and headingPath growth is bounded so sectionKey
    // doesn't become unique for every heading.
    if (looksLikeHeading(line, lines[i + 1])) {
      flush();
      current.push(line);
      headingPath = [...headingPath, line].slice(-MAX_HEURISTIC_HEADING_DEPTH);
      continue;
    }

    // Ordinary content line — accumulate into the current paragraph.
    current.push(line);
  }

  flush();
  return blocks;
};

export default { normalizeToBlocks };
