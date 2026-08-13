// Numeric helpers for semantic chunking.

// Cosine similarity between two vectors, in [-1, 1]. 1 = identical direction.
//
// Mismatched widths throw rather than return a number, because every number
// available is a lie that corrupts chunking silently: without a guard the loop
// reads `b[i]` as `undefined` and returns NaN, which fails every breakpoint
// comparison and collapses the document into one chunk; returning 0 instead
// reads as maximum distance and shatters it into one passage per unit. Both
// produce passages with no useful embedding and no error anywhere.
//
// Callers only ever compare vectors from a single embedding batch, and the
// gateway asserts the model's width up front, so reaching this is a programming
// error — the one case worth being loud about.
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity requires vectors of equal width, got ${a.length} and ${b.length}.`
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
};

// Semantic distance: 0 = same topic, larger = more likely a topic boundary.
// This is what pgvector's `<=>` operator computes natively; here it's used on
// in-memory unit embeddings to pick chunk breakpoints.
export const semanticDistance = (a: number[], b: number[]): number => {
  return 1 - cosineSimilarity(a, b);
};

// Token estimator used to size chunks and enforce the embedding model's input
// limit without pulling in a tokenizer dependency.
//
// The familiar "4 characters per token" rule holds only for ASCII. Subword
// vocabularies are trained overwhelmingly on Latin text, so an accented or
// non-Latin character rarely merges with its neighbours and costs close to a
// whole token by itself. A flat /4 therefore undercounts Vietnamese by ~35%,
// which silently produced chunks half again as large as `CHUNK_MAX_TOKENS`
// allows — and a chunk that spans several topics has no useful embedding.
//
// Measured against nomic-embed-text on Vietnamese prose, splitting the two
// rates lands within ~4% of the real count while leaving ASCII text on the
// same /4 it always used.
const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 1.1;

export const estimateTokens = (text: string): number => {
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      nonAscii++;
    }
  }

  const ascii = text.length - nonAscii;
  return Math.max(
    1,
    Math.ceil(
      ascii / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN
    )
  );
};
