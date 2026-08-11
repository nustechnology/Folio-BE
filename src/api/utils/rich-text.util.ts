import sanitizeHtml from 'sanitize-html';

import { NOTE } from '~/api/utils/constants';

/**
 * Inline formatting and lists, shared by every profile: what any of our
 * editors can produce, plus what a user may paste from a formatted document.
 */
const SHARED_TAGS = [
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
 * Block containers no editor offers. Rewriting them to paragraphs keeps the
 * text separated — discarding the tag would run the heading into the
 * paragraph that follows it.
 */
const CONTAINER_BLOCKS = ['div', 'section', 'article', 'pre'];

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

type SanitizeProfile = {
  /** Kept verbatim. */
  keep: string[];
  /** Kept as text, rewritten to `<p>`. */
  demote: string[];
};

/**
 * The note editor offers no headings and no blockquote, so both are demoted.
 * This profile's observable behaviour is pinned by `specs/notes/spec.md`
 * REQ-004 — widen the notebook profile below instead of touching it.
 */
const NOTE_PROFILE: SanitizeProfile = {
  keep: SHARED_TAGS,
  demote: [...HEADINGS, ...CONTAINER_BLOCKS, 'blockquote']
};

/**
 * The notebook is a report: its editor offers H1–H3 and blockquote, so those
 * survive. `h4`–`h6` still demote — a pasted `h4` should keep its text rather
 * than acquire a level the toolbar can never toggle off.
 */
const NOTEBOOK_PROFILE: SanitizeProfile = {
  keep: [...SHARED_TAGS, 'h1', 'h2', 'h3', 'blockquote'],
  demote: [...HEADINGS.slice(3), ...CONTAINER_BLOCKS]
};

const sanitize = (html: string, profile: SanitizeProfile): string =>
  sanitizeHtml(html, {
    allowedTags: [...profile.keep, ...profile.demote],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      ...Object.fromEntries(profile.demote.map((tag) => [tag, 'p'])),
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
        target: '_blank'
      })
    },
    disallowedTagsMode: 'discard'
  });

export const sanitizeRichText = (html: string): string =>
  sanitize(html, NOTE_PROFILE);

export const sanitizeNotebookHtml = (html: string): string =>
  sanitize(html, NOTEBOOK_PROFILE);

/**
 * Headings and blockquote are boundaries too, for the notebook profile that
 * keeps them. Note content never reaches here carrying either — they are
 * demoted to `<p>` before this runs — so the note count is unaffected.
 */
const BLOCK_BOUNDARY = /<\/(?:p|li|h1|h2|h3|blockquote)>|<br\s*\/?>/gi;
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
