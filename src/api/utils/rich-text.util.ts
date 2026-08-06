import sanitizeHtml from 'sanitize-html';

import { NOTE } from '~/api/utils/constants';

/**
 * Formatting the note editor toolbar can produce, plus what a user may paste
 * from a formatted document. Anything else is discarded on save.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a'
];

/**
 * Blocks the editor does not offer but a paste can carry. Rewriting them to
 * paragraphs keeps the text separated — discarding the tag would run the
 * heading into the paragraph that follows it.
 */
const BLOCKS_AS_PARAGRAPH = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'div',
  'section',
  'article',
  'blockquote',
  'pre'
];

const blockTransforms = Object.fromEntries(
  BLOCKS_AS_PARAGRAPH.map((tag) => [tag, 'p'])
);

export const sanitizeRichText = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS, ...BLOCKS_AS_PARAGRAPH],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      ...blockTransforms,
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
        target: '_blank'
      })
    },
    disallowedTagsMode: 'discard'
  });

const BLOCK_BOUNDARY = /<\/(?:p|li)>|<br\s*\/?>/gi;
const REMAINING_TAGS = /<[^>]*>/g;

/**
 * Entity decoding must resolve `&amp;` last, otherwise `&amp;lt;` would decode
 * twice and turn escaped markup back into a tag.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&apos;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&']
];

/**
 * Plain-text projection of note markup. This is what the 20,000-character
 * limit is measured against, and it mirrors the count the web editor shows:
 * block elements become newlines, everything else is stripped.
 */
export const toPlainText = (html: string): string => {
  const withBreaks = html.replace(BLOCK_BOUNDARY, '\n');
  const stripped = withBreaks.replace(REMAINING_TAGS, '');
  const decoded = ENTITIES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    stripped
  );
  return decoded.replace(/\r\n/g, '\n').trim();
};

/** Short single-line excerpt for note list items. */
export const toPreview = (html: string): string => {
  const plainText = toPlainText(html).replace(/\s+/g, ' ');
  return plainText.length > NOTE.PREVIEW_MAX_LENGTH
    ? `${plainText.slice(0, NOTE.PREVIEW_MAX_LENGTH).trimEnd()}…`
    : plainText;
};
