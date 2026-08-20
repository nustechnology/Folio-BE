import { describe, expect, it } from 'vitest';
import AskPrompt from '~/api/services/ask-prompt.service';
import type { EvidenceItem } from '~/api/services/retrieval.service';
import type { AnswerCitation, StoredMessage } from '~/api/types/ask';
import { ASK } from '~/api/utils/constants';

// `EvidenceItem` reaches deep into the Prisma-generated `SourceType`, but
// `processAnswer` only ever reads `passage.sourceTitle` / `passage.content` and
// counts the array. Building the full shape would test the fixture, not the code.
const makeEvidence = (count: number): EvidenceItem[] =>
  Array.from(
    { length: count },
    (_, index) =>
      ({
        passage: {
          id: `passage-${index + 1}`,
          sourceId: `source-${index + 1}`,
          content: `Evidence body ${index + 1}`,
          sourceTitle: `Source ${index + 1}`
        },
        pageReference: null,
        sectionReference: null,
        locationLabel: null
      }) as unknown as EvidenceItem
  );

const makeCitations = (sourceIds: string[]): AnswerCitation[] =>
  sourceIds.map(
    (sourceId, index) =>
      ({ sourceId, id: `c${index}` }) as unknown as AnswerCitation
  );

describe('processAnswer — limitation splitting', () => {
  // Regression: the matcher was case-insensitive and unanchored, so this exact
  // input returned content "The paper lists a" with zero citations — the rest of
  // the answer was hoisted into the caveat and both markers were lost.
  it('ignores the word "limitation:" written as prose mid-answer', () => {
    const result = AskPrompt.processAnswer(
      'The paper lists a limitation: sample size [1]. Growth was strong [2].',
      makeEvidence(3)
    );

    expect(result.limitation).toBeNull();
    expect(result.content).toBe(
      'The paper lists a limitation: sample size [1]. Growth was strong [2].'
    );
    expect(result.usedEvidence).toHaveLength(2);
  });

  it('lifts a caveat written on its own line', () => {
    const result = AskPrompt.processAnswer(
      'Kết quả A [1] [2].\nLIMITATION: bằng chứng mỏng.',
      makeEvidence(3)
    );

    expect(result.content).toBe('Kết quả A [1] [2].');
    expect(result.limitation).toBe('bằng chứng mỏng.');
  });

  // The reason the matcher was loosened in the first place; must survive the fix.
  it('lifts a caveat run onto the end of the previous sentence', () => {
    const result = AskPrompt.processAnswer(
      'Không có thông tin. LIMITATION: thiếu dữ liệu.',
      makeEvidence(3)
    );

    expect(result.content).toBe('Không có thông tin.');
    expect(result.limitation).toBe('thiếu dữ liệu.');
  });

  it('strips markdown emphasis wrapped around the caveat', () => {
    const result = AskPrompt.processAnswer(
      'Kết quả A [1].\n**LIMITATION: bằng chứng mỏng.**',
      makeEvidence(2)
    );

    expect(result.limitation).toBe('bằng chứng mỏng.');
  });

  it('leaves an answer without a caveat untouched', () => {
    const raw = 'Doanh thu tăng [1]. Chi phí giảm [2].';
    const result = AskPrompt.processAnswer(raw, makeEvidence(2));

    expect(result.limitation).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('lifts a caveat that follows a closing quote', () => {
    const result = AskPrompt.processAnswer(
      'Kết quả tốt." LIMITATION: sau ngoặc kép.',
      makeEvidence(2)
    );

    expect(result.content).toBe('Kết quả tốt."');
    expect(result.limitation).toBe('sau ngoặc kép.');
  });

  // A marker in the caveat must mean the same passage as the same marker in the
  // body — otherwise the banner points at a different citation than the answer.
  it('renumbers citation markers inside the caveat through the same map', () => {
    const result = AskPrompt.processAnswer(
      'Claim [2].\nLIMITATION: only [3] covers this.',
      makeEvidence(3)
    );

    // Evidence 2 → [1] (first cited), evidence 3 → [2] (second).
    expect(result.content).toBe('Claim [1].');
    expect(result.limitation).toBe('only [2] covers this.');
    expect(result.usedEvidence.map((e) => e.passage.content)).toEqual([
      'Evidence body 2',
      'Evidence body 3'
    ]);
  });

  // Malformed output; last-wins keeps the tail, which is where the caveat
  // belongs. The earlier one stays as body text rather than being guessed at.
  it('takes the last caveat when the model emits more than one', () => {
    const result = AskPrompt.processAnswer(
      'A [1]. LIMITATION: first.\nMore [2].\nLIMITATION: second.',
      makeEvidence(2)
    );

    expect(result.limitation).toBe('second.');
    expect(result.content).toContain('More [2].');
  });
});

describe('processAnswer — citation markers', () => {
  it('resolves every marker form the model reaches for', () => {
    const cases: [string, string][] = [
      ['Claim [1].', 'Claim [1].'],
      ['Claim [1,2].', 'Claim [1] [2].'],
      ['Claim [1-3].', 'Claim [1] [2] [3].'],
      ['Claim [E2].', 'Claim [1].'],
      ['Claim [^1].', 'Claim [1].'],
      ['Claim [source 3].', 'Claim [1].']
    ];

    for (const [raw, expected] of cases) {
      expect(AskPrompt.processAnswer(raw, makeEvidence(5)).content).toBe(
        expected
      );
    }
  });

  it('leaves ordinary bracketed prose exactly as written', () => {
    const raw = 'See table [a], note [ok] and item [TODO].';
    expect(AskPrompt.processAnswer(raw, makeEvidence(3)).content).toBe(raw);
  });

  // Regression: widening the parser to accept ranges made it swallow years,
  // deleting them from the answer.
  it('preserves bracketed years and year ranges', () => {
    expect(
      AskPrompt.processAnswer('Báo cáo năm [2023] tăng [1].', makeEvidence(3))
        .content
    ).toBe('Báo cáo năm [2023] tăng [1].');

    expect(
      AskPrompt.processAnswer(
        'Giai đoạn [2020-2024] mạnh [1].',
        makeEvidence(3)
      ).content
    ).toBe('Giai đoạn [2020-2024] mạnh [1].');
  });

  it('drops a hallucinated marker inside the plausible citation range', () => {
    const result = AskPrompt.processAnswer('Claim [7].', makeEvidence(5));

    expect(result.content).toBe('Claim.');
    expect(result.usedEvidence).toHaveLength(0);
  });

  it('drops a too-wide range that is still citation-shaped', () => {
    const result = AskPrompt.processAnswer('Claim [1-40].', makeEvidence(5));

    expect(result.content).toBe('Claim.');
    expect(result.usedEvidence).toHaveLength(0);
  });

  // A range too wide to expand parses to no numbers at all. Judging
  // plausibility from that empty array (`[].every()` is true) classified every
  // rejected range as an invented citation and deleted year ranges from answers.
  it('preserves a wide range of implausible numbers as prose', () => {
    expect(
      AskPrompt.processAnswer(
        'Giai đoạn [2020-2060] mạnh [1].',
        makeEvidence(3)
      ).content
    ).toBe('Giai đoạn [2020-2060] mạnh [1].');

    expect(
      AskPrompt.processAnswer('Trang [100-140] mô tả [1].', makeEvidence(3))
        .content
    ).toBe('Trang [100-140] mô tả [1].');
  });

  // The invariant the whole pass exists to protect: `[n]` resolved by array
  // index must always land on a real citation.
  it('renumbers to a dense 1..n in order of first appearance', () => {
    const result = AskPrompt.processAnswer(
      'First [4]. Second [2]. Third [4] again.',
      makeEvidence(5)
    );

    expect(result.content).toBe('First [1]. Second [2]. Third [1] again.');
    expect(result.usedEvidence.map((e) => e.passage.content)).toEqual([
      'Evidence body 4',
      'Evidence body 2'
    ]);
  });

  it('cleans up whitespace left behind by a dropped marker', () => {
    const result = AskPrompt.processAnswer(
      'Claim [9] , and more [1] .',
      makeEvidence(2)
    );

    expect(result.content).toBe('Claim, and more [1].');
  });
});

describe('shouldAttachUnlinkedEvidence', () => {
  const base = {
    content: 'An answer with no markers at all.',
    usedEvidenceCount: 0,
    evidenceCount: 5,
    limitation: null as string | null,
    stopped: false
  };

  it('attaches evidence to a genuine uncited answer', () => {
    expect(AskPrompt.shouldAttachUnlinkedEvidence(base)).toBe(true);
  });

  // Regression: a halted generation never reached the markers it was going to
  // write, so its missing citations are not evidence of an ungrounded answer.
  it('does not attach evidence when generation was stopped', () => {
    expect(
      AskPrompt.shouldAttachUnlinkedEvidence({ ...base, stopped: true })
    ).toBe(false);
  });

  // Regression: Stop pressed before the first token persists an empty turn,
  // which would otherwise get three citations and a warning attached to nothing.
  it('does not attach evidence to an empty answer', () => {
    expect(
      AskPrompt.shouldAttachUnlinkedEvidence({ ...base, content: '' })
    ).toBe(false);
    expect(
      AskPrompt.shouldAttachUnlinkedEvidence({ ...base, content: '   \n ' })
    ).toBe(false);
  });

  it('does not pad an answer that wrote its own limitation', () => {
    expect(
      AskPrompt.shouldAttachUnlinkedEvidence({
        ...base,
        limitation: 'The document does not address this.'
      })
    ).toBe(false);
  });

  it('does nothing when there was no evidence to attach', () => {
    expect(
      AskPrompt.shouldAttachUnlinkedEvidence({ ...base, evidenceCount: 0 })
    ).toBe(false);
  });

  it('does nothing when the answer already cited evidence', () => {
    expect(
      AskPrompt.shouldAttachUnlinkedEvidence({ ...base, usedEvidenceCount: 2 })
    ).toBe(false);
  });
});

describe('deriveLimitation', () => {
  it('outranks every other caveat when the answer is unlinked', () => {
    expect(
      AskPrompt.deriveLimitation({
        citations: makeCitations(['source-1']),
        readySourceCount: 4,
        scope: 'space',
        unlinked: true
      })
    ).toBe(ASK.UNLINKED_EVIDENCE_LIMITATION);
  });

  it('returns null when nothing was cited', () => {
    expect(
      AskPrompt.deriveLimitation({
        citations: [],
        readySourceCount: 3,
        scope: 'space'
      })
    ).toBeNull();
  });

  it('flags a space-wide answer grounded in a single source', () => {
    expect(
      AskPrompt.deriveLimitation({
        citations: makeCitations(['source-1', 'source-1']),
        readySourceCount: 4,
        scope: 'space'
      })
    ).toBe(
      'Only 1 of 4 ready sources contains evidence bearing on this question.'
    );
  });

  it('does not flag a space-wide answer spanning several sources', () => {
    expect(
      AskPrompt.deriveLimitation({
        citations: makeCitations(['source-1', 'source-2']),
        readySourceCount: 4,
        scope: 'space'
      })
    ).toBeNull();
  });

  it('never flags single-source grounding when the scope is one source', () => {
    expect(
      AskPrompt.deriveLimitation({
        citations: makeCitations(['source-1']),
        readySourceCount: 4,
        scope: 'source'
      })
    ).toBeNull();
  });
});

describe('buildMessages', () => {
  const makeHistory = (count: number): StoredMessage[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${index} [1]`,
      createdAt: '2026-08-11T00:00:00.000Z'
    }));

  it('opens with the system prompt and numbers evidence from 1', () => {
    const messages = AskPrompt.buildMessages({
      question: 'What changed?',
      evidence: makeEvidence(2),
      history: [],
      researchObjective: 'Understand the trial',
      scopeLabel: 'the whole space'
    });

    expect(messages[0].role).toBe('system');
    expect(messages).toHaveLength(2);

    const user = messages[1].content;
    expect(user).toContain('[1] Source 1');
    expect(user).toContain('[2] Source 2');
    expect(user).toContain('Question: What changed?');
    expect(user).toContain('Evidence scope: the whole space');
  });

  // Replayed markers belonged to an earlier retrieval; leaving them in would
  // collide with the numbering of this turn's evidence.
  it('strips citation markers from replayed assistant turns only', () => {
    const messages = AskPrompt.buildMessages({
      question: 'And the second?',
      evidence: makeEvidence(1),
      history: makeHistory(2),
      researchObjective: 'Understand the trial',
      scopeLabel: 'the whole space'
    });

    const [, user, assistant] = messages;
    expect(user.content).toBe('Turn 0 [1]');
    expect(assistant.content).toBe('Turn 1');
  });

  it('caps replayed history at HISTORY_MESSAGE_LIMIT', () => {
    const messages = AskPrompt.buildMessages({
      question: 'Latest?',
      evidence: makeEvidence(1),
      history: makeHistory(ASK.HISTORY_MESSAGE_LIMIT + 6),
      researchObjective: 'Understand the trial',
      scopeLabel: 'the whole space'
    });

    // system + capped history + the current question
    expect(messages).toHaveLength(ASK.HISTORY_MESSAGE_LIMIT + 2);
  });
});
