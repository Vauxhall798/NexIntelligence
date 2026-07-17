# DocuMind — Document RAG & Q&A

A full-stack Retrieval-Augmented Generation app. Upload unstructured documents
(`.txt`, `.pdf`, `.docx`, `.pptx`), and ask questions about them in a chat
interface. Answers are grounded in your documents and cite their sources.

## Tech Stack

- **Frontend:** React, Vite, Tailwind CSS, Lucide React
- **Backend:** Node.js, Express (single server on port 3000, using Vite in middleware mode)
- **AI:** `@google/genai` (Gemini `text-embedding-004` for embeddings, `gemini-2.5-flash` for generation)
- **Vector store:** in-memory array with cosine-similarity search (no external DB required)

## How it works

1. **Ingest** (`POST /api/ingest`): files are uploaded via `multer` (memory storage),
   text is extracted per file type, split into ~500-character chunks with 100-character
   overlap, embedded with Gemini, and stored in memory alongside their source metadata.
2. **Ask** (`POST /api/ask`): the question is embedded, compared against every stored
   chunk with cosine similarity, and the top-K chunks are passed to `gemini-2.5-flash`
   as context, along with the running chat history for conversational memory. The
   model is instructed to answer only from the given context and to cite sources
   inline as `[source: filename.ext]`.

## Prerequisites

- Node.js 18+
- A Gemini API key — get one free at https://aistudio.google.com/apikey

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# then edit .env and set GEMINI_API_KEY=your_actual_key

# 3. Run the app in development mode
npm run dev
```

The app will be available at **http://localhost:3000** (Express serves both the
API and the Vite-powered React frontend from the same port).

## Environment variables (`.env`)

| Variable         | Description                                  |
|------------------|-----------------------------------------------|
| `GEMINI_API_KEY` | Your Gemini API key (required)                |
| `APP_URL`        | Base URL the app is served from               |
| `PORT`           | Port for the Express server (default `3000`)  |

## Production build

```bash
npm run build   # builds the React client into dist/client
npm start        # runs the Express server in production mode, serving the built client
```

## Project structure

```
rag-app/
├── server.ts              # Express app: routes + Vite dev/prod integration
├── server/
│   ├── textExtract.ts     # .txt / .pdf / .docx / .pptx text extraction + chunking
│   └── vectorStore.ts     # in-memory vector store, Gemini embeddings & generation
├── src/
│   ├── App.tsx            # main chat + document management UI
│   ├── main.tsx
│   ├── types.ts            # shared request/response types
│   └── index.css
├── index.html
├── .env.example
└── package.json
```

## API reference

### `POST /api/ingest`
`multipart/form-data` with one or more `files` fields.
Returns `{ documents: DocumentSummary[] }`.

### `GET /api/documents`
Returns the currently ingested documents.

### `DELETE /api/documents`
Clears the in-memory vector store.

### `POST /api/ask`
```json
{
  "question": "What does the report say about Q3 revenue?",
  "history": [{ "role": "user", "text": "..." }, { "role": "model", "text": "..." }],
  "topK": 4
}
```
Returns:
```json
{
  "answer": "...",
  "sources": [{ "filename": "report.pdf", "chunkIndex": 3, "similarity": 0.82, "preview": "..." }],
  "metrics": { "maxSimilarity": 0.82, "minSimilarity": 0.51, "latencyMs": 940, "chunksRetrieved": 4 }
}
```

## Notes & limitations

- The vector store is **in-memory only** — it resets whenever the server restarts.
  For persistence across restarts, swap `InMemoryVectorStore` in `server/vectorStore.ts`
  for a real vector database (e.g. pgvector, Pinecone, Qdrant, Chroma).
- Large files are capped at 25MB per upload in `server.ts` (`multer` limits).
