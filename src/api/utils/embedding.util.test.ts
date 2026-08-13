import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  estimateTokens,
  semanticDistance
} from '~/api/utils/embedding.util';

describe('cosineSimilarity', () => {
  it('scores identical vectors as 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('scores parallel vectors of different magnitude as 1', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('scores orthogonal vectors as 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('scores opposed vectors as -1', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it('does not divide by zero on a zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  // Any number returned here corrupts chunking silently — NaN collapses the
  // document into one chunk, 0 shatters it into one passage per unit.
  it('throws on mismatched widths rather than returning a number', () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/equal width/);
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/equal width/);
  });
});

describe('semanticDistance', () => {
  it('is 0 for identical vectors', () => {
    expect(semanticDistance([1, 2, 3], [1, 2, 3])).toBeCloseTo(0);
  });

  it('is the complement of cosine similarity', () => {
    const a = [0.2, 0.9, -0.4];
    const b = [0.7, 0.1, 0.5];
    expect(semanticDistance(a, b)).toBeCloseTo(1 - cosineSimilarity(a, b));
  });
});

describe('estimateTokens', () => {
  // The estimator was split into ASCII and non-ASCII rates. English text must
  // land on exactly the same count as the old flat `length / 4`, or every
  // existing chunk boundary silently moves.
  it('matches the legacy 4-chars-per-token rule for ASCII', () => {
    const samples = [
      'a',
      'hello world',
      'The trial enrolled 240 participants across four sites.',
      'x'.repeat(1000)
    ];

    for (const sample of samples) {
      expect(estimateTokens(sample)).toBe(Math.ceil(sample.length / 4));
    }
  });

  it('never returns 0, even for empty input', () => {
    expect(estimateTokens('')).toBe(1);
  });

  it('prices non-Latin text well above ASCII of the same length', () => {
    const vietnamese = 'Doanh thu tăng trưởng mạnh trong giai đoạn khảo sát';
    const ascii = 'x'.repeat(vietnamese.length);

    expect(estimateTokens(vietnamese)).toBeGreaterThan(estimateTokens(ascii));
  });

  it('prices a fully non-ASCII string near one token per character', () => {
    const text = '日本語'.repeat(10); // 30 non-ASCII characters
    expect(estimateTokens(text)).toBe(Math.ceil(30 / 1.1));
  });

  // `assemblePassages` accumulates per-unit counts and cuts when the running
  // total reaches the target. A non-monotonic estimator would let a passage
  // grow without ever tripping the ceiling.
  it('never decreases as text grows', () => {
    const alphabet = 'aă1 .đQ';
    let previous = 0;
    let text = '';

    for (let i = 0; i < 200; i++) {
      text += alphabet[i % alphabet.length];
      const current = estimateTokens(text);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('lands between the two rates for mixed text', () => {
    const mixed = 'report: tăng trưởng';
    const nonAscii = [...mixed].filter((c) => c.charCodeAt(0) > 127).length;
    const ascii = mixed.length - nonAscii;

    expect(estimateTokens(mixed)).toBe(Math.ceil(ascii / 4 + nonAscii / 1.1));
    expect(estimateTokens(mixed)).toBeGreaterThan(Math.ceil(mixed.length / 4));
    expect(estimateTokens(mixed)).toBeLessThan(mixed.length);
  });
});
