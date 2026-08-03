// Normalization: turns the raw extracted text into ordered "blocks" (paragraphs)
// tagged with a heading path. The heading path is the key signal the semantic
// chunker uses to avoid merging across section boundaries, and it is later
// projected onto Passage locators so citations stay resolvable.
export type Block = {
  text: string;
  headingPath: string[];
  order: number;
};

// Heuristic: a short line without trailing punctuation is treated as a heading
// (works for plain-text docs; markdown `#` headings are handled separately).
const MAX_HEADING_LENGTH = 80;

const looksLikeHeading = (line: string): boolean => {
  return line.length <= MAX_HEADING_LENGTH && !/[.!?:;,]$/.test(line);
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

  for (const rawLine of lines) {
    const line = rawLine.trim();
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

    // Plain-text heading heuristic — adds to the current heading path.
    if (looksLikeHeading(line)) {
      headingPath = [...headingPath, line];
      continue;
    }

    // Ordinary content line — accumulate into the current paragraph.
    current.push(line);
  }

  flush();
  return blocks;
};

export default { normalizeToBlocks };
