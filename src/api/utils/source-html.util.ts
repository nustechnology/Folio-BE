// Sanitization for the reader's HTML. `structuredContent.html` is rendered with
// dangerouslySetInnerHTML, and every source feeding it is untrusted — an
// uploaded .md or .docx can carry <script>, <iframe> or on* handlers. All
// parser output passes through here before being stored.
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'div',
  'span',
  'section',
  'article',
  'blockquote',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'small',
  'sub',
  'sup',
  'abbr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'figure',
  'figcaption',
  'img',
  'a',
  'input' // GFM task-list checkboxes only — forced to disabled below
];

export const sanitizeSourceHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      col: ['span'],
      colgroup: ['span'],
      input: ['type', 'checked', 'disabled'],
      '*': ['class', 'id', 'data-lang', 'data-diagram']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    // `style` is dropped wholesale — our own styling is injected after
    // sanitization, so nothing is lost and CSS exfiltration stays impossible.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
        target: '_blank'
      }),
      input: (tagName, attribs) => ({
        tagName,
        attribs: {
          type: 'checkbox',
          disabled: 'disabled',
          ...(attribs.checked !== undefined ? { checked: 'checked' } : {})
        }
      })
    },
    // Drop the contents of these; other stripped tags keep their text.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'head'],
    disallowedTagsMode: 'discard'
  });

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

// For the parsers that build markup by hand (TXT, manual notes, PDF pages),
// where document text is interpolated straight into HTML.
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

export default { sanitizeSourceHtml, escapeHtml };
