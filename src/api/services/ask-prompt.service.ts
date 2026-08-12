// These four are type-only on purpose. `retrieval.service` and
// `model-gateway.service` both import `~/config/enviroment`, which throws at
// import time when required secrets are absent — an `import type` keeps this
// module (and its tests) free of that dependency rather than relying on the
// compiler happening to elide an unused value import.
import type { ChatMessage } from '~/api/services/model-gateway.service';
import type { EvidenceItem } from '~/api/services/retrieval.service';
import type { AnswerCitation, StoredMessage } from '~/api/types/ask';
import { ASK } from '~/api/utils/constants';

// Prompt construction and answer post-processing for the Ask endpoint.
//
// Everything here exists to keep one promise the product makes: an answer says
// only what the retrieved evidence says, and every claim can be opened and
// checked. The model is given numbered evidence and told to cite by number; the
// post-processing pass then throws away any number it invented and renumbers
// what is left, so a citation badge in the UI can never point at nothing.

const SYSTEM_PROMPT = [
  'You are Folio, a research assistant that answers strictly from the evidence supplied in the prompt.',
  '',
  'Rules:',
  '- Use ONLY the numbered evidence passages. Never use outside knowledge, and never guess. Even a fact you are certain of must be dropped if no passage states it.',
  '- Cite every factual claim with the evidence number in square brackets, e.g. "turnover rose sharply [2]". Cite multiple passages as "[1] [3]".',
  '- EVERY sentence that states a fact MUST end with at least one bracketed number. An answer with no brackets is a failed answer, no matter how short or how obvious the fact seems.',
  '- Write the answer in the same language as the question, but keep the bracketed numbers exactly as digits in square brackets. Never translate, reword, or renumber a marker.',
  '- If the evidence does not answer the question, say so plainly instead of speculating.',
  '- Do not invent evidence numbers. Only numbers listed below exist.',
  '- Be concise and factual: 1-3 short paragraphs, no preamble, no closing summary.',
  '- Report disagreement between sources explicitly when it exists.',
  `- If the evidence is thin, one-sided, or comes from a single source, end your reply with one final line: "${ASK.LIMITATION_PREFIX} <one sentence>". Otherwise omit that line entirely.`,
  '',
  'Example of a correctly formatted answer:',
  'The trial enrolled 240 participants across four sites [1]. Dropout reached 18% by week twelve, concentrated in the placebo arm [2] [3].'
].join('\n');

const formatEvidence = (evidence: EvidenceItem[]): string =>
  evidence
    .map((item, index) => {
      const location = item.locationLabel ? `, ${item.locationLabel}` : '';
      return [
        `[${index + 1}] ${item.passage.sourceTitle}${location}`,
        item.passage.content
      ].join('\n');
    })
    .join('\n\n');

/**
 * Prior turns are replayed as plain chat messages so follow-ups ("and the
 * second one?") resolve. Citation markers are stripped from replayed answers —
 * their numbering belonged to an earlier retrieval and would collide with the
 * numbering of the evidence supplied for this turn.
 */
const toHistory = (messages: StoredMessage[]): ChatMessage[] =>
  messages.slice(-ASK.HISTORY_MESSAGE_LIMIT).map((message) => ({
    role: message.role,
    content:
      message.role === 'assistant'
        ? message.content.replace(/\s*\[\d+\]/g, '')
        : message.content
  }));

const buildMessages = (options: {
  question: string;
  evidence: EvidenceItem[];
  history: StoredMessage[];
  researchObjective: string;
  scopeLabel: string;
}): ChatMessage[] => [
  { role: 'system', content: SYSTEM_PROMPT },
  ...toHistory(options.history),
  {
    role: 'user',
    content: [
      `Research objective: ${options.researchObjective}`,
      `Evidence scope: ${options.scopeLabel}`,
      '',
      'Evidence:',
      formatEvidence(options.evidence),
      '',
      `Question: ${options.question}`
    ].join('\n')
  }
];

// Markers are matched in two steps — any short bracketed run first, then a
// check that its contents are citation-shaped. A single regex that accepts
// every form a model reaches for ("[1, 2]", "[E3]", "[1-3]", "[^2]") while
// still rejecting ordinary bracketed prose is unreadable; this splits the
// permissive match from the strict interpretation.
const BRACKETED_RUN = /\[([^\][]{1,40})\]/g;
const MARKER_BODY = /^(?:e|ev|evidence|source|ref|\^|#)?\s*(\d+(?:\s*[-–—,;]\s*\d+)*)$/i;
const MARKER_SEPARATOR = /[,;]/;
const MARKER_RANGE = /[-–—]/;

/** A malformed range must not expand into hundreds of markers. */
const MAX_RANGE_SPAN = 20;

/**
 * Every integer literally present in a marker body, without expanding ranges or
 * rejecting anything. `parseMarkerNumbers` answers "which evidence does this
 * name?"; this answers "what did the model actually write?", which is what
 * decides whether an unresolvable run was a citation attempt or prose.
 */
const literalNumbers = (body: string): number[] =>
  body
    .split(/\D+/)
    .filter(Boolean)
    .map(Number);

/**
 * Expands a marker body into the evidence numbers it names. "1" → [1],
 * "1, 3" → [1, 3], "1-3" → [1, 2, 3]. Anything unparseable yields nothing,
 * which drops the marker rather than pointing it somewhere arbitrary.
 */
const parseMarkerNumbers = (body: string): number[] => {
  const numbers: number[] = [];

  for (const part of body.split(MARKER_SEPARATOR)) {
    const bounds = part.split(MARKER_RANGE).map((value) => Number(value.trim()));

    if (bounds.length === 1) {
      if (Number.isInteger(bounds[0])) {
        numbers.push(bounds[0]);
      }
      continue;
    }

    const [start, end] = bounds;
    const isUsableRange =
      bounds.length === 2 &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      end >= start &&
      end - start <= MAX_RANGE_SPAN;

    if (isUsableRange) {
      for (let n = start; n <= end; n++) {
        numbers.push(n);
      }
    }
  }

  return numbers;
};

// The prompt asks for the caveat on a line of its own, but models routinely run
// it onto the end of the last sentence ("…không có thông tin. LIMITATION: …").
// Anchoring to the start of a line let that form through untouched, so the
// marker was rendered to the reader as part of the answer.
//
// Both shapes are accepted, but only at a sentence boundary and only in the
// exact casing the prompt specifies. Matching case-insensitively anywhere in the
// reply meant an answer that merely discussed a study's "limitation:" had
// everything after that word torn out of its body and promoted to the caveat —
// citations included. The word is ordinary prose for a research assistant; the
// marker is not.
const LIMITATION_PREFIX_PATTERN = ASK.LIMITATION_PREFIX.replace(
  /[.*+?^${}()|[\]\\]/g,
  '\\$&'
);
// The optional closing quote/bracket covers a sentence that ends inside one
// ("…no data." LIMITATION: …) — without it the marker is left rendered in the
// answer, which is the defect this pattern exists to prevent.
const LIMITATION_MARKER = new RegExp(
  `(?:^|(?<=[.!?…]["'”’)\\]]?\\s))[ \\t]*\\*{0,2}${LIMITATION_PREFIX_PATTERN}\\*{0,2}[ \\t]*`,
  'gm'
);

/** Emphasis the model wrapped around the caveat is formatting, not content. */
const TRAILING_EMPHASIS = /\*+$/;

const splitLimitation = (
  raw: string
): { body: string; limitation: string | null } => {
  LIMITATION_MARKER.lastIndex = 0;

  let last: RegExpExecArray | null = null;
  let match = LIMITATION_MARKER.exec(raw);
  while (match !== null) {
    last = match;
    match = LIMITATION_MARKER.exec(raw);
  }

  if (!last) {
    return { body: raw, limitation: null };
  }

  const after = raw.slice(last.index + last[0].length);
  const [caveatLine] = after.split('\n');

  return {
    body: (raw.slice(0, last.index) + after.slice(caveatLine.length)).trimEnd(),
    limitation:
      caveatLine.trim().replace(TRAILING_EMPHASIS, '').trim() || null
  };
};

export type ProcessedAnswer = {
  content: string;
  /** Retrieved evidence the answer actually cited, in renumbered order. */
  usedEvidence: EvidenceItem[];
  limitation: string | null;
};

/**
 * Rewrites a generated answer into what the client actually renders.
 *
 * The model cites evidence by its position in the prompt, but only some of that
 * evidence usually gets used. Markers are remapped to a dense 1..n over the
 * passages actually cited (in order of first appearance) and unresolvable
 * markers are dropped, which is what lets the client resolve `[n]` by index
 * into the citations array.
 */
const processAnswer = (
  raw: string,
  evidence: EvidenceItem[]
): ProcessedAnswer => {
  const { body: withoutLimitation, limitation } = splitLimitation(raw);

  // Original evidence index (0-based) → position in the renumbered answer.
  const renumbered = new Map<number, number>();

  const renumberMarkers = (text: string): string =>
    text
      .replace(BRACKETED_RUN, (marker, body: string) => {
        const bodyMatch = body.match(MARKER_BODY);
        // Ordinary bracketed prose, not a citation — leave it as written.
        if (!bodyMatch) {
          return marker;
        }

        const numbers = parseMarkerNumbers(bodyMatch[1]);
        const positions = numbers
          .map((number) => number - 1)
          .filter((index) => index >= 0 && index < evidence.length)
          .map((evidenceIndex) => {
            let position = renumbered.get(evidenceIndex);
            if (position === undefined) {
              position = renumbered.size + 1;
              renumbered.set(evidenceIndex, position);
            }
            return position;
          });

        if (positions.length === 0) {
          // Nothing resolved. A run whose numbers are all in citation range is
          // a marker the model invented and must be dropped, so a badge can
          // never point at nothing. Anything larger was never a citation — a
          // year, a figure — and belongs to the sentence.
          //
          // Judged from the numbers the model literally wrote, not from
          // `numbers`: a range too wide to expand (`[1-40]`) parses to an empty
          // array, and `[].every()` is true, which would classify every
          // rejected range as an invented citation and delete `[2020-2060]`.
          const written = literalNumbers(bodyMatch[1]);
          const isPlausibleCitation =
            written.length > 0 &&
            written.every((number) => number <= ASK.PLAUSIBLE_MARKER_MAX);
          return isPlausibleCitation ? '' : marker;
        }

        // A grouped marker is emitted as separate handles so the client can
        // resolve each one on its own.
        return [...new Set(positions)]
          .map((position) => `[${position}]`)
          .join(' ');
      })
      // Dropping markers can leave doubled spaces or a space before punctuation.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,;:)])/g, '$1')
      .trim();

  const content = renumberMarkers(withoutLimitation);

  // The caveat is renumbered through the same map, after the body, so `[n]`
  // means the same citation wherever it appears. Left alone, a caveat like
  // "only [1] covers this" would keep the model's original numbering while the
  // body around it had been renumbered — the banner would point at a different
  // passage than the same marker in the answer.
  const renumberedLimitation =
    limitation === null ? null : renumberMarkers(limitation) || null;

  const usedEvidence = [...renumbered.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([evidenceIndex]) => evidence[evidenceIndex]);

  return { content, limitation: renumberedLimitation, usedEvidence };
};

/**
 * Whether to attach an answer's retrieved evidence even though the answer cited
 * none of it.
 *
 * Smaller models routinely ignore the citation instruction and answer from their
 * own knowledge instead, which reads as a confident answer with nothing to check
 * it against. Attaching what retrieval supplied keeps the answer verifiable, and
 * `UNLINKED_EVIDENCE_LIMITATION` says plainly that the link is unproven.
 *
 * Three cases must not take that fallback:
 *
 * - a **stopped** generation was cut off mid-sentence and never reached the
 *   markers it was going to write;
 * - an **empty** answer (Stop pressed before the first token) would otherwise
 *   get citations and a warning attached to nothing at all;
 * - a model that wrote its **own limitation line** was following the prompt's
 *   format, so the absence of markers means it found nothing worth citing.
 *   Padding such a reply — usually "the document does not say" — with passages
 *   it deliberately declined to cite would present unrelated evidence as if it
 *   bore on the question.
 */
const shouldAttachUnlinkedEvidence = (options: {
  content: string;
  usedEvidenceCount: number;
  evidenceCount: number;
  limitation: string | null;
  stopped: boolean;
}): boolean =>
  !options.stopped &&
  options.content.trim().length > 0 &&
  options.usedEvidenceCount === 0 &&
  options.evidenceCount > 0 &&
  options.limitation === null;

/**
 * Falls back to a caveat the model did not write itself. Answers grounded in a
 * single document, or in a sliver of the space's evidence, are the cases worth
 * flagging — the user cannot see the retrieval, only the answer.
 */
const deriveLimitation = (options: {
  citations: AnswerCitation[];
  readySourceCount: number;
  scope: 'space' | 'source';
  /** The answer cited nothing and its evidence was attached by fallback. */
  unlinked?: boolean;
}): string | null => {
  // Outranks every other caveat: an uncited answer may not rest on the
  // evidence at all, which is a stronger warning than thin evidence.
  if (options.unlinked) {
    return ASK.UNLINKED_EVIDENCE_LIMITATION;
  }

  if (options.citations.length === 0) {
    return null;
  }

  const citedSources = new Set(options.citations.map((c) => c.sourceId));
  if (
    options.scope === 'space' &&
    options.readySourceCount > 1 &&
    citedSources.size === 1
  ) {
    return `Only 1 of ${options.readySourceCount} ready sources contains evidence bearing on this question.`;
  }

  return null;
};

export default {
  buildMessages,
  processAnswer,
  shouldAttachUnlinkedEvidence,
  deriveLimitation
};
