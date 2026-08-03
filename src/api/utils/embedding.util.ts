// Numeric helpers for semantic chunking.

// Cosine similarity between two vectors, in [-1, 1]. 1 = identical direction.
export const cosineSimilarity = (a: number[], b: number[]): number => {
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

// Rough token estimator (~4 chars per token) used to size chunks and enforce
// the embedding model's input limit without pulling in a tokenizer dependency.
export const estimateTokens = (text: string): number => {
  return Math.max(1, Math.ceil(text.length / 4));
};
