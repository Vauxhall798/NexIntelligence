import { embedQuery, similaritySearch, generateAnswer, store } from "../server/vectorStore";
import type { ChatMessage } from "../src/types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const { question, history, topK } = req.body as {
      question?: string;
      history?: ChatMessage[];
      topK?: number;
    };

    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "`question` is required." });
    }

    if (store.isEmpty()) {
      return res.json({
        answer: "No documents have been uploaded yet. Please upload some documents first.",
        sources: [],
        metrics: { maxSimilarity: 0, minSimilarity: 0, latencyMs: 0, chunksRetrieved: 0 },
      });
    }

    const k = Math.min(Math.max(Number(topK) || 4, 1), 20);
    const start = Date.now();
    const queryEmbedding = await embedQuery(question);
    const retrieved = similaritySearch(queryEmbedding, k);

    // Retry generation in case the model service is temporarily unavailable.
    const maxAttempts = 3;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { answer, sources } = await generateAnswer(question, history ?? [], retrieved);
        const similarities = retrieved.map((r) => r.similarity);
        const response = {
          answer,
          sources,
          metrics: {
            maxSimilarity: similarities.length ? Math.max(...similarities) : 0,
            minSimilarity: similarities.length ? Math.min(...similarities) : 0,
            latencyMs: Date.now() - start,
            chunksRetrieved: retrieved.length,
          },
        };
        return res.json(response);
      } catch (err: any) {
        lastErr = err;
        console.warn(`[api/ask] generation attempt ${attempt} failed:`, err?.message ?? err);
        // If it's the last attempt, break and return error below.
        if (attempt < maxAttempts) {
          // exponential backoff
          const delay = 500 * Math.pow(3, attempt - 1);
          await sleep(delay);
          continue;
        }
      }
    }

    // If we reach here, all attempts failed. Surface clearer errors where possible.
    if (lastErr && lastErr.error && lastErr.error.status === "UNAVAILABLE") {
      return res.status(503).json({ error: `Model unavailable: ${lastErr.error.message}` });
    }

    const message = lastErr?.message ?? "Failed to generate answer.";
    console.error("[api/ask] all generation attempts failed:", lastErr);
    res.status(500).json({ error: message });
  } catch (err: any) {
    console.error("[api/ask] error:", err);
    res.status(500).json({ error: err.message ?? "Failed to answer question." });
  }
}
