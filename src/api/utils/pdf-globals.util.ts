// pdf.mjs evaluates `new DOMMatrix()` at module top level, so without the global
// the import itself throws — despite pdfjs warning only that "rendering may be
// broken". It normally borrows the class from @napi-rs/canvas, a native binding
// whose musl build faults with SIGILL on CPUs lacking the instructions it was
// built for, killing the ingestion worker outright. Arithmetic has no such
// dependency.
//
// The 2D subset only. Extraction reads text and never rasterizes, so a bare
// identity is all it constructs; the operations exist because a matrix that
// silently computed the wrong transform would be worse than a missing one. The
// tests check them against the native DOMMatrix.

type MatrixInit = number[] | Float32Array | Float64Array | undefined;

export class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: MatrixInit) {
    if (!init) {
      return;
    }
    // The spec also accepts a 16-element 3D matrix and a CSS transform string,
    // neither reachable from text extraction. Guessing would invent behaviour.
    if (init.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
    }
  }

  static #from(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ) {
    return new DOMMatrixPolyfill([a, b, c, d, e, f]);
  }

  get isIdentity(): boolean {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }

  // Both snapshot every operand before writing: `m.multiplySelf(m)` is legal,
  // and assigning field by field would feed already-updated values back in.
  /** this = this × other */
  multiplySelf(other: DOMMatrixPolyfill): this {
    const { a, b, c, d, e, f } = this;
    const o = { ...other };
    this.a = a * o.a + c * o.b;
    this.b = b * o.a + d * o.b;
    this.c = a * o.c + c * o.d;
    this.d = b * o.c + d * o.d;
    this.e = a * o.e + c * o.f + e;
    this.f = b * o.e + d * o.f + f;
    return this;
  }

  /** this = other × this */
  preMultiplySelf(other: DOMMatrixPolyfill): this {
    const { a, b, c, d, e, f } = other;
    const t = { ...this };
    this.a = a * t.a + c * t.b;
    this.b = b * t.a + d * t.b;
    this.c = a * t.c + c * t.d;
    this.d = b * t.c + d * t.d;
    this.e = a * t.e + c * t.f + e;
    this.f = b * t.e + d * t.f + f;
    return this;
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    return this;
  }

  scaleSelf(sx = 1, sy = sx): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    return this;
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) {
      // The spec marks a non-invertible matrix with NaN components, which
      // callers test for; throwing would not.
      this.a = this.b = this.c = this.d = this.e = this.f = NaN;
      return this;
    }
    const { a, b, c, d, e, f } = this;
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }

  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return this.#clone().multiplySelf(other);
  }

  translate(tx = 0, ty = 0): DOMMatrixPolyfill {
    return this.#clone().translateSelf(tx, ty);
  }

  scale(sx = 1, sy = sx): DOMMatrixPolyfill {
    return this.#clone().scaleSelf(sx, sy);
  }

  inverse(): DOMMatrixPolyfill {
    return this.#clone().invertSelf();
  }

  #clone(): DOMMatrixPolyfill {
    return DOMMatrixPolyfill.#from(
      this.a,
      this.b,
      this.c,
      this.d,
      this.e,
      this.f
    );
  }

  toString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
  }
}

// Must run before the first `import('pdfjs-dist/...')` in the process — the
// global is read while that module evaluates, which is why pdfjs is imported
// dynamically rather than at the top of parse.service.
export const installPdfGlobals = (): void => {
  if (!globalThis.DOMMatrix) {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill;
  }
};

export default { installPdfGlobals, DOMMatrixPolyfill };
