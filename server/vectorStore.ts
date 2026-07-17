import { GoogleGenAI } from "@google/genai";
import type { ChatMessage, DocumentSummary, SourceRef } from "../src/types";
import { pipeline } from "@xenova/transformers";

const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const GENERATION_MODEL = "gemini-3.5-flash";

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "[vectorStore] GEMINI_API_KEY is not set. Requests to Gemini will fail until it is configured in .env"
  );
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

let embeddingPipelinePromise: Promise<any> | null = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    embeddingPipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return embeddingPipelinePromise;
}

function normalizeEmbeddingResult(embedding: unknown): number[][] {
  if (Array.isArray(embedding)) {
    if (Array.isArray(embedding[0])) {
      return embedding as number[][];
    }
    throw new Error("Unsupported embedding array shape");
  }

  if (embedding && typeof embedding === "object") {
    const tensor = embedding as {
      dims?: number[];
      shape?: number[];
      data?: number[] | Record<string, number>;
    };
    const dims = tensor.dims ?? tensor.shape;
    if (!dims || dims.length < 2) {
      throw new Error("Unsupported embedding tensor dims");
    }

    const rawData = tensor.data;
    let flat: number[] = [];
    if (Array.isArray(rawData)) {
      flat = rawData;
    } else if (rawData && typeof rawData === "object") {
      flat = Object.keys(rawData)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => Number((rawData as Record<string, number>)[key]));
    }

    if (dims.length === 3 && dims[0] === 1) {
      const [_, seqLen, dim] = dims;
      const rows: number[][] = [];
      for (let i = 0; i < seqLen; i++) {
        rows.push(flat.slice(i * dim, (i + 1) * dim));
      }
      return rows;
    }

    if (dims.length === 2) {
      return flat.length === dims[0] * dims[1]
        ? Array.from({ length: dims[0] }, (_, i) =>
            flat.slice(i * dims[1], (i + 1) * dims[1])
          )
        : [];
    }
  }

  throw new Error("Unsupported embedding result format");
}

function meanPoolEmbedding(embedding: unknown): number[] {
  const tokenEmbeddings = normalizeEmbeddingResult(embedding);
  const dim = tokenEmbeddings[0]?.length ?? 0;
  const output = new Array<number>(dim).fill(0);

  for (const tokenEmbedding of tokenEmbeddings) {
    for (let i = 0; i < dim; i++) {
      output[i] += tokenEmbedding[i];
    }
  }

  const count = tokenEmbeddings.length || 1;
  return output.map((value) => value / count);
}

async function embedText(text: string): Promise<number[]> {
  const embedder: any = await getEmbeddingPipeline();
  const rawEmbedding = await embedder(text);
  return meanPoolEmbedding(rawEmbedding);
}

export interface Chunk {
  id: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

interface DocumentMeta {
  id: string;
  filename: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedAt: string;
}

// --- In-memory "vector database" -------------------------------------------------
class InMemoryVectorStore {
  private chunks: Chunk[] = [];
  private documents: Map<string, DocumentMeta> = new Map();

  isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  addDocument(meta: DocumentMeta, chunks: Chunk[]) {
    this.documents.set(meta.id, meta);
    this.chunks.push(...chunks);
  }

  listDocuments(): DocumentSummary[] {
    return [...this.documents.values()].sort((a, b) =>
      a.uploadedAt < b.uploadedAt ? 1 : -1
    );
  }

  reset() {
    this.chunks = [];
    this.documents.clear();
  }

  allChunks(): Chunk[] {
    return this.chunks;
  }
}

export const store = new InMemoryVectorStore();

// --- Embedding helpers -------------------------------------------------------------

/**
 * Embeds a batch of text strings via a local Hugging Face sentence transformer.
 * We avoid remote embedding API calls by using a local transformer pipeline.
 */
export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  return Promise.all(texts.map((text) => embedText(text)));
}

export async function embedQuery(question: string): Promise<number[]> {
  const [embedding] = await embedTexts([question], "RETRIEVAL_QUERY");
  return embedding;
}

// --- Similarity search ---------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function similaritySearch(
  queryEmbedding: number[],
  topK: number
): { chunk: Chunk; similarity: number }[] {
  const scored = store
    .allChunks()
    .map((chunk) => ({
      chunk,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, topK);
}

// --- Generation ------------------------------------------------------------------------

export async function generateAnswer(
  question: string,
  history: ChatMessage[],
  retrieved: { chunk: Chunk; similarity: number }[]
): Promise<{ answer: string; sources: SourceRef[] }> {
  const context = retrieved
    .map(
      ({ chunk }, i) =>
        `[${i + 1}] (source: ${chunk.filename}, chunk ${chunk.chunkIndex})\n${chunk.text}`
    )
    .join("\n\n---\n\n");

  const systemInstruction = `You are a document Q&A assistant. Answer the user's question strictly using
the CONTEXT provided below, which was retrieved from the user's uploaded documents.

Rules:
- Base your answer only on the given context. You may reasonably deduce or synthesize an
  answer that combines multiple context passages, but do not invent facts that aren't
  supported by the context.
- Cite the source of every factual claim inline using the format [source: filename.ext].
  If a claim draws on multiple chunks, you may cite multiple sources.
- If the context does not contain enough information to answer, say so clearly instead
  of guessing.
- Be concise and directly answer the question first, then add supporting detail.

CONTEXT:
${context}`;

  const contents = [
    ...history.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    { role: "user" as const, parts: [{ text: question }] },
  ];

  const result = await ai.models.generateContent({
    model: GENERATION_MODEL,
    contents,
    config: { systemInstruction },
  });

  const answer = result.text ?? "";

  const sources: SourceRef[] = retrieved.map(({ chunk, similarity }) => ({
    filename: chunk.filename,
    chunkIndex: chunk.chunkIndex,
    similarity,
    preview: chunk.text.slice(0, 160) + (chunk.text.length > 160 ? "…" : ""),
  }));

  return { answer, sources };
}
