import { describe, expect, it } from 'vitest';
import { DOMMatrixPolyfill } from '~/api/utils/pdf-globals.util';

const components = (m: DOMMatrixPolyfill) => [m.a, m.b, m.c, m.d, m.e, m.f];

// A polyfill that constructs but transforms incorrectly is worse than a missing
// one — it would silently misplace text. Expected values are computed by hand
// from the 2D matrix [[a, c, e], [b, d, f], [0, 0, 1]].
describe('DOMMatrixPolyfill', () => {
  it('defaults to the identity, which is what pdfjs constructs on import', () => {
    const m = new DOMMatrixPolyfill();
    expect(components(m)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(m.isIdentity).toBe(true);
  });

  it('takes its components from a 6-element initializer', () => {
    expect(components(new DOMMatrixPolyfill([2, 3, 4, 5, 6, 7]))).toEqual([
      2, 3, 4, 5, 6, 7
    ]);
  });

  it('keeps the identity for initializers it does not model', () => {
    expect(components(new DOMMatrixPolyfill([1, 2, 3]))).toEqual([
      1, 0, 0, 1, 0, 0
    ]);
  });

  it('translates in its own coordinate space, after scaling', () => {
    // scale(2,3) then translate(10,10) moves the origin by (20,30), not (10,10).
    const m = new DOMMatrixPolyfill().scaleSelf(2, 3).translateSelf(10, 10);
    expect(components(m)).toEqual([2, 0, 0, 3, 20, 30]);
  });

  it('multiplies in the documented order (this x other)', () => {
    const a = new DOMMatrixPolyfill([1, 0, 0, 1, 10, 20]); // translate
    const b = new DOMMatrixPolyfill([2, 0, 0, 2, 0, 0]); // scale
    expect(components(a.multiply(b))).toEqual([2, 0, 0, 2, 10, 20]);
    expect(components(b.multiply(a))).toEqual([2, 0, 0, 2, 20, 40]);
  });

  it('pre-multiplies in the opposite order', () => {
    const scaled = new DOMMatrixPolyfill([2, 0, 0, 2, 0, 0]);
    const translated = new DOMMatrixPolyfill([1, 0, 0, 1, 10, 20]);
    expect(components(scaled.preMultiplySelf(translated))).toEqual([
      2, 0, 0, 2, 10, 20
    ]);
  });

  // Assigning component by component fed already-updated values back into the
  // later terms, so a matrix multiplied by itself came out wrong.
  it('multiplies a matrix by itself without reading its own partial results', () => {
    const m = new DOMMatrixPolyfill([1, 2, 3, 4, 5, 6]);
    expect(components(m.multiplySelf(m))).toEqual([7, 10, 15, 22, 28, 40]);
  });

  it('pre-multiplies a matrix by itself likewise', () => {
    const m = new DOMMatrixPolyfill([1, 2, 3, 4, 5, 6]);
    expect(components(m.preMultiplySelf(m))).toEqual([7, 10, 15, 22, 28, 40]);
  });

  it('does not mutate the operand', () => {
    const target = new DOMMatrixPolyfill([1, 2, 3, 4, 5, 6]);
    const operand = new DOMMatrixPolyfill([7, 8, 9, 10, 11, 12]);
    target.multiplySelf(operand);
    expect(components(operand)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('inverts so that a matrix times its inverse is the identity', () => {
    const m = new DOMMatrixPolyfill([2, 0, 0, 4, 30, 50]);
    const round = m.multiply(m.inverse());
    components(round).forEach((value, i) =>
      expect(value).toBeCloseTo([1, 0, 0, 1, 0, 0][i])
    );
  });

  it('inverts a rotation-and-translation back to the original point', () => {
    const m = new DOMMatrixPolyfill([0, 1, -1, 0, 5, 7]);
    const inverse = m.inverse();
    expect(components(m.multiply(inverse))[4]).toBeCloseTo(0);
    expect(components(m.multiply(inverse))[5]).toBeCloseTo(0);
  });

  it('reports NaN components for a singular matrix rather than throwing', () => {
    const m = new DOMMatrixPolyfill([0, 0, 0, 0, 1, 1]).invertSelf();
    components(m).forEach((value) => expect(Number.isNaN(value)).toBe(true));
  });

  it('leaves the receiver untouched for non-Self operations', () => {
    const m = new DOMMatrixPolyfill([1, 0, 0, 1, 5, 5]);
    m.scale(3);
    m.translate(9, 9);
    expect(components(m)).toEqual([1, 0, 0, 1, 5, 5]);
  });

  it('defaults scaleSelf to a uniform scale', () => {
    expect(components(new DOMMatrixPolyfill().scaleSelf(3))).toEqual([
      3, 0, 0, 3, 0, 0
    ]);
  });
});
