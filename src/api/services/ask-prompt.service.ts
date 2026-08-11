import { ChatMessage } from '~/api/services/model-gateway.service';
import { EvidenceItem } from '~/api/services/retrieval.service';
import { AnswerCitation, StoredMessage } from '~/api/types/ask';
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
  '- Use ONLY the numbered evidence passages. Never use outside knowledge, and never guess.',
  '- Cite every factual claim with the evidence number in square brackets, e.g. "turnover rose sharply [2]". Cite multiple passages as "[1] [3]".',
  '- If the evidence does not answer the question, say so plainly instead of speculating.',
  '- Do not invent evidence numbers. Only numbers listed below exist.',
  '- Be concise and factual: 1-3 short paragraphs, no preamble, no closing summary.',
  '- Report disagreement between sources explicitly when it exists.',
  `- If the evidence is thin, one-sided, or comes from a single source, end your reply with one final line: "${ASK.LIMITATION_PREFIX} <one sentence>". Otherwise omit that line entirely.`
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

const CITATION_MARKER = /\[(\d+)\]/g;
const LIMITATION_LINE = new RegExp(
  `^[ \\t]*\\*{0,2}${ASK.LIMITATION_PREFIX}\\*{0,2}[ \\t]*(.+)$`,
  'im'
);

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
  const limitationMatch = raw.match(LIMITATION_LINE);
  const limitation = limitationMatch?.[1]?.trim() || null;
  const withoutLimitation = limitationMatch
    ? raw.replace(LIMITATION_LINE, '').trimEnd()
    : raw;

  // Original evidence index (0-based) → position in the renumbered answer.
  const renumbered = new Map<number, number>();

  const content = withoutLimitation
    .replace(CITATION_MARKER, (marker, digits: string) => {
      const evidenceIndex = Number(digits) - 1;
      if (evidenceIndex < 0 || evidenceIndex >= evidence.length) {
        return '';
      }
      if (!renumbered.has(evidenceIndex)) {
        renumbered.set(evidenceIndex, renumbered.size + 1);
      }
      return `[${renumbered.get(evidenceIndex)}]`;
    })
    // Dropping markers can leave doubled spaces or a space before punctuation.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:)])/g, '$1')
    .trim();

  const usedEvidence = [...renumbered.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([evidenceIndex]) => evidence[evidenceIndex]);

  return { content, limitation, usedEvidence };
};

/**
 * Falls back to a caveat the model did not write itself. Answers grounded in a
 * single document, or in a sliver of the space's evidence, are the cases worth
 * flagging — the user cannot see the retrieval, only the answer.
 */
const deriveLimitation = (options: {
  citations: AnswerCitation[];
  readySourceCount: number;
  scope: 'space' | 'source';
}): string | null => {
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

export default { buildMessages, processAnswer, deriveLimitation };
