import { describe, expect, it } from 'vitest';
import { assemblePassages, type Unit } from '~/api/services/chunking.service';
import { estimateTokens } from '~/api/utils/embedding.util';

// `charsPerUnit / 4` tokens each, since the text is pure ASCII.
const makeUnits = (count: number, charsPerUnit = 40): Unit[] =>
  Array.from({ length: count }, (_, index) => ({
    text: 'x'.repeat(charsPerUnit),
    blockIndex: Math.floor(index / 2),
    order: index,
    headingPath: ['Section A']
  }));

// Large enough that only explicit breakpoints cut, never the token ceiling.
const NO_TOKEN_CUT = 1_000_000;

describe('assemblePassages — breakpoints', () => {
  it('cuts after each breakpoint index, inclusive', () => {
    const passages = assemblePassages(
      makeUnits(6),
      new Set([1, 3]),
      NO_TOKEN_CUT
    );

    // units 0-1, 2-3, then the 4-5 tail
    expect(passages).toHaveLength(3);
    expect(passages.map((p) => p.locator.firstOrder)).toEqual([0, 2, 4]);
    expect(passages.map((p) => p.locator.lastOrder)).toEqual([1, 3, 5]);
  });

  it('emits the trailing units even with no breakpoint at the end', () => {
    const passages = assemblePassages(makeUnits(5), new Set([0]), NO_TOKEN_CUT);

    expect(passages).toHaveLength(2);
    expect(passages[1].locator.lastOrder).toBe(4);
  });

  it('returns one passage when there are no breakpoints', () => {
    const passages = assemblePassages(makeUnits(4), new Set(), NO_TOKEN_CUT);

    expect(passages).toHaveLength(1);
    expect(passages[0].content.split(' ')).toHaveLength(4);
  });

  it('returns nothing for no units', () => {
    expect(assemblePassages([], new Set(), NO_TOKEN_CUT)).toEqual([]);
  });
});

describe('assemblePassages — token ceiling', () => {
  // The running-sum rewrite replaced a per-slice re-count. These pin the
  // boundary rule so a future change cannot quietly move every chunk edge.
  it('forces a boundary once the running total reaches the target', () => {
    // 10 tokens per unit, target 30 → a cut after every third unit.
    const passages = assemblePassages(makeUnits(9, 40), new Set(), 30);

    expect(passages).toHaveLength(3);
    expect(passages.map((p) => p.locator.firstOrder)).toEqual([0, 3, 6]);
  });

  it('resets the running total after a breakpoint cut', () => {
    // Breakpoint at 0 consumes one unit; the ceiling must then count from unit
    // 1, not from the start of the document.
    const passages = assemblePassages(makeUnits(7, 40), new Set([0]), 30);

    expect(passages.map((p) => p.locator.firstOrder)).toEqual([0, 1, 4]);
  });

  it('never emits a single unit larger than the target as two passages', () => {
    const passages = assemblePassages(makeUnits(2, 4000), new Set(), 30);

    // One oversized unit cannot be split further here — it becomes its own
    // passage rather than being dropped or merged.
    expect(passages).toHaveLength(2);
    expect(passages[0].locator.firstOrder).toBe(0);
  });

  it('keeps each passage within roughly the target', () => {
    const target = 30;
    const passages = assemblePassages(makeUnits(20, 40), new Set(), target);

    for (const passage of passages.slice(0, -1)) {
      // Allow one unit of overshoot: the boundary is detected after appending.
      expect(estimateTokens(passage.content)).toBeLessThanOrEqual(target + 10);
    }
  });
});

describe('assemblePassages — locator metadata', () => {
  it('spans the block range the units came from', () => {
    const passages = assemblePassages(makeUnits(6), new Set([3]), NO_TOKEN_CUT);

    // makeUnits puts two units per block, so units 0-3 span blocks 0-1.
    expect(passages[0].locator.blockRange).toEqual([0, 1]);
    expect(passages[1].locator.blockRange).toEqual([2, 2]);
  });

  it('takes the heading path from the first unit in the passage', () => {
    const units = makeUnits(4);
    units[2].headingPath = ['Section B'];

    const passages = assemblePassages(units, new Set([1]), NO_TOKEN_CUT);

    expect(passages[0].locator.headingPath).toEqual(['Section A']);
    expect(passages[1].locator.headingPath).toEqual(['Section B']);
  });

  it('joins unit text with a single space', () => {
    const passages = assemblePassages(makeUnits(3, 4), new Set(), NO_TOKEN_CUT);

    expect(passages[0].content).toBe('xxxx xxxx xxxx');
  });
});
