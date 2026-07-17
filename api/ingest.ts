import Busboy from "busboy";
import { randomUUID } from "crypto";
import { extractText, chunkText, type UploadedFile } from "../server/textExtract";
import { store, embedTexts, type Chunk } from "../server/vectorStore";

export default function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }
  let responded = false;
  const bb = new Busboy({ headers: req.headers });
  const files: UploadedFile[] = [];

  bb.on(
    "file",
    (
      _fieldname: string,
      fileStream: NodeJS.ReadableStream,
      info: { filename: string; mimeType: string; encoding?: string }
    ) => {
      const { filename, mimeType } = info;
      const buffers: Buffer[] = [];
      fileStream.on("data", (d: Buffer) => buffers.push(d));
      fileStream.on("end", () => {
        const buffer = Buffer.concat(buffers);
        files.push({ originalname: filename, mimetype: mimeType, buffer, size: buffer.length });
      });
    }
  );

  bb.on("finish", async () => {
    try {
      if (files.length === 0) {
        return res.status(400).json({ error: "No files were uploaded." });
      }

      for (const file of files) {
        let text: string;
        try {
          text = await extractText(file);
        } catch (err: any) {
          return res.status(400).json({ error: err.message });
        }

        const rawChunks = chunkText(text, 500, 100);
        if (rawChunks.length === 0) {
          return res.status(400).json({ error: `No extractable text found in ${file.originalname}.` });
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

      if (!responded) {
        responded = true;
        res.json({ documents: store.listDocuments() });
      }
    } catch (err: any) {
      console.error("[api/ingest] error:", err);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: err.message ?? "Ingestion failed." });
      }
    }
  });

  bb.on("error", (err: any) => {
    console.error("[api/ingest] busboy error:", err);
    if (!responded) {
      responded = true;
      res.status(500).json({ error: err?.message ?? "Upload parsing failed." });
    }
  });

  req.on("aborted", () => {
    console.warn("[api/ingest] request aborted by client");
    if (!responded) {
      responded = true;
      // client aborted, nothing to send
    }
  });

  // Pipe the request stream to Busboy
  req.pipe(bb);
}
