export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export interface SourceRef {
  filename: string;
  chunkIndex: number;
  similarity: number;
  preview: string;
}

export interface AskResponse {
  answer: string;
  sources: SourceRef[];
  metrics: {
    maxSimilarity: number;
    minSimilarity: number;
    latencyMs: number;
    chunksRetrieved: number;
  };
}

export interface DocumentSummary {
  id: string;
  filename: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedAt: string;
}

export interface IngestResponse {
  documents: DocumentSummary[];
}
