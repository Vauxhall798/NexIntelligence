import "dotenv/config";
import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { extractText, chunkText, type UploadedFile } from "./server/textExtract";
import {
  store,
  embedTexts,
  embedQuery,
  similaritySearch,
  generateAnswer,
  type Chunk,
} from "./server/vectorStore";
import type { ChatMessage, IngestResponse, AskResponse } from "./src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

const app = express();

// Large payload limits to comfortably handle long chat histories / doc text.
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
});

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

// ---------------------------------------------------------------------------
// POST /api/ingest — accepts one or more files, extracts + chunks + embeds them
// ---------------------------------------------------------------------------
app.post("/api/ingest", upload.array("files"), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: "No files were uploaded." });
    }

    for (const file of files) {
      const uploaded: UploadedFile = {
        originalname: file.originalname,
        mimetype: file.mimetype,
        buffer: file.buffer,
        size: file.size,
      };

      let text: string;
      try {
        text = await extractText(uploaded);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const rawChunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
      if (rawChunks.length === 0) {
        return res.status(400).json({
          error: `No extractable text found in ${file.originalname}.`,
        });
      }

      const embeddings = await embedTexts(rawChunks, "RETRIEVAL_DOCUMENT");
      const documentId = randomUUID();

      const chunks: Chunk[] = rawChunks.map((text, i) => ({
        id: randomUUID(),
        documentId,
        filename: file.originalname,
        chunkIndex: i,
        text,
        embedding: embeddings[i],
      }));

      store.addDocument(
        {
          id: documentId,
          filename: file.originalname,
          sizeBytes: file.size,
          chunkCount: chunks.length,
          uploadedAt: new Date().toISOString(),
        },
        chunks
      );
    }

    const response: IngestResponse = { documents: store.listDocuments() };
    res.json(response);
  } catch (err: any) {
    console.error("[/api/ingest] error:", err);
    res.status(500).json({ error: err.message ?? "Ingestion failed." });
  }
});

// GET /api/documents — list currently ingested documents
app.get("/api/documents", (_req, res) => {
  res.json({ documents: store.listDocuments() });
});

// DELETE /api/documents — clear the in-memory store
app.delete("/api/documents", (_req, res) => {
  store.reset();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/ask — retrieval + generation
// ---------------------------------------------------------------------------
app.post("/api/ask", async (req, res) => {
  const start = Date.now();
  try {
    const {
      question,
      history,
      topK,
    }: { question: string; history?: ChatMessage[]; topK?: number } = req.body;

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "`question` is required." });
    }

    if (store.isEmpty()) {
      const response: AskResponse = {
        answer:
          "No documents have been uploaded yet. Please upload some documents first.",
        sources: [],
        metrics: {
          maxSimilarity: 0,
          minSimilarity: 0,
          latencyMs: Date.now() - start,
          chunksRetrieved: 0,
        },
      };
      return res.json(response);
    }

    const k = Math.min(Math.max(Number(topK) || 4, 1), 20);
    const queryEmbedding = await embedQuery(question);
    const retrieved = similaritySearch(queryEmbedding, k);

    const { answer, sources } = await generateAnswer(
      question,
      history ?? [],
      retrieved
    );

    const similarities = retrieved.map((r) => r.similarity);
    const response: AskResponse = {
      answer,
      sources,
      metrics: {
        maxSimilarity: similarities.length ? Math.max(...similarities) : 0,
        minSimilarity: similarities.length ? Math.min(...similarities) : 0,
        latencyMs: Date.now() - start,
        chunksRetrieved: retrieved.length,
      },
    };

    res.json(response);
  } catch (err: any) {
    console.error("[/api/ask] error:", err);
    res.status(500).json({ error: err.message ?? "Failed to answer question." });
  }
});

// ---------------------------------------------------------------------------
// Vite integration: dev middleware vs. production static serving
// ---------------------------------------------------------------------------
async function start() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);

    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(
          path.resolve(__dirname, "index.html"),
          "utf-8"
        );
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const clientDist = path.resolve(__dirname, "dist/client");
    app.use(express.static(clientDist));
    app.use("*", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.listen(PORT, () => {
    console.log(`🚀 RAG app listening on http://localhost:${PORT}`);
  });
}

start();
