import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  FileText,
  FileType,
  File,
  UploadCloud,
  Send,
  Trash2,
  Settings2,
  Gauge,
  Clock,
  Layers,
  BookOpenText,
  Sparkles,
  Moon,
  Sun,
} from "lucide-react";
import type { AskResponse, ChatMessage, DocumentSummary, SourceRef } from "./types";

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  sources?: SourceRef[];
}

const ACCEPTED_EXT = [".txt", ".pdf", ".docx", ".pptx"];

function fileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText size={16} className="text-rose-400" />;
  if (ext === "docx") return <FileType size={16} className="text-sky-400" />;
  if (ext === "pptx") return <Layers size={16} className="text-amber-400" />;
  return <File size={16} className="text-slate-400" />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [topK, setTopK] = useState(4);
  const [lastMetrics, setLastMetrics] = useState<AskResponse["metrics"] | null>(
    null
  );

  const isLight = theme === "light";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => setDocuments(d.documents ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, thinking]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const formData = new FormData();
    list.forEach((f) => formData.append("files", f));

    setUploading(true);
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: formData });
      const contentType = res.headers.get("content-type") || "";
      let data: any = null;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        // non-JSON response (likely HTML error page) — read text for clearer error
        const text = await res.text();
        throw new Error(text || "Upload failed (non-JSON response)");
      }

      if (!res.ok) throw new Error(data.error || "Upload failed");
      setDocuments(data.documents ?? []);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: `⚠️ Upload failed: ${err.message}`,
        },
      ]);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
    },
    [uploadFiles]
  );

  const clearDocuments = useCallback(async () => {
    await fetch("/api/documents", { method: "DELETE" });
    setDocuments([]);
  }, []);

  const askQuestion = useCallback(async () => {
    const question = input.trim();
    if (!question || thinking) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: question };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);

    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      text: m.text,
    }));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, topK }),
      });
      const data: AskResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get an answer");

      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: data.answer,
          sources: data.sources,
        },
      ]);
      setLastMetrics(data.metrics);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "model",
          text: `⚠️ ${err.message}`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, messages, topK]);

  return (
    <div className={`h-screen flex ${isLight ? "bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
      {/* Sidebar */}
      <aside className={`w-80 shrink-0 border-r ${isLight ? "bg-white border-slate-200" : "bg-slate-900/40 border-slate-800/80"} flex flex-col`}>
        <div className={`px-5 py-5 border-b ${isLight ? "border-slate-200" : "border-slate-800/80"}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <BookOpenText size={17} />
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-tight">DocuMind</h1>
              <p className="text-[11px] text-slate-500">Document RAG &amp; Q&amp;A</p>
            </div>
          </div>
        </div>

        {/* Upload zone */}
        <div className="px-5 py-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragActive
                ? "border-indigo-400 bg-indigo-500/10"
                : isLight
                ? "border-slate-300 hover:border-slate-400 hover:bg-slate-100"
                : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/40"
            }`}
          >
            <UploadCloud
              size={22}
              className={`mx-auto mb-2 ${
                dragActive
                  ? "text-indigo-300"
                  : isLight
                  ? "text-slate-600"
                  : "text-slate-500"
              }`}
            />
            <p className={`text-xs font-medium ${isLight ? "text-slate-700" : "text-slate-300"}`}>
              Drop files or click to upload
            </p>
            <p className={`text-[11px] mt-1 ${isLight ? "text-slate-500" : "text-slate-500"}`}>
              .txt · .pdf · .docx · .pptx
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_EXT.join(",")}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {uploading && (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-indigo-300">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 thinking-dot" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 thinking-dot"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 thinking-dot"
                  style={{ animationDelay: "0.3s" }}
                />
              </span>
              Embedding documents…
            </div>
          )}
        </div>

        {/* Document list */}
        <div className={`flex-1 overflow-y-auto px-5 pb-4 ${isLight ? "bg-slate-50" : "bg-transparent"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[11px] uppercase tracking-wider font-medium ${isLight ? "text-slate-500" : "text-slate-500"}`}>
              Knowledge base ({documents.length})
            </span>
            {documents.length > 0 && (
              <button
                onClick={clearDocuments}
                className="text-slate-500 hover:text-rose-400 transition-colors"
                title="Clear all documents"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {documents.length === 0 && !uploading && (
            <p className={`text-[12px] italic mt-4 ${isLight ? "text-slate-500" : "text-slate-600"}`}>
              No documents yet. Upload something to get started.
            </p>
          )}

          <ul className="space-y-1.5">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ${isLight ? "bg-slate-100 border border-slate-200" : "bg-slate-800/40 border border-slate-800"}`}
              >
                {fileIcon(doc.filename)}
                <div className="min-w-0 flex-1">
                  <p className={`text-[12px] truncate ${isLight ? "text-slate-900" : "text-slate-200"}`}>{doc.filename}</p>
                  <p className={`text-[10.5px] ${isLight ? "text-slate-500" : "text-slate-500"}`}>
                    {formatBytes(doc.sizeBytes)} · {doc.chunkCount} chunks
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Settings */}
        <div className={`px-5 py-4 border-t space-y-3 ${isLight ? "border-slate-200" : "border-slate-800/80"}`}>
          <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium ${isLight ? "text-slate-500" : "text-slate-500"}`}>
            <Settings2 size={12} /> Retrieval settings
          </div>
          <div>
            <div className="flex items-center justify-between text-[12px] text-slate-300 mb-1">
              <span>Top K chunks</span>
              <span className="font-mono text-indigo-300">{topK}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          {lastMetrics && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Metric
                icon={<Gauge size={12} />}
                label="Max similarity"
                value={`${(lastMetrics.maxSimilarity * 100).toFixed(1)}%`}
                isLight={isLight}
              />
              <Metric
                icon={<Clock size={12} />}
                label="Latency"
                value={`${lastMetrics.latencyMs} ms`}
                isLight={isLight}
              />
            </div>
          )}
        </div>
      </aside>

      {/* Main chat panel */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className={`px-6 py-4 border-b flex items-center justify-between ${isLight ? "border-slate-200" : "border-slate-800/80"}`}>
          <div>
            <h2 className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-slate-100"}`}>Chat</h2>
            <p className={`text-[11px] ${isLight ? "text-slate-500" : "text-slate-500"}`}>
              Ask questions grounded in your uploaded documents
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(isLight ? "dark" : "light")}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12px] font-medium transition ${isLight ? "bg-slate-100 text-slate-900 border border-slate-200" : "bg-slate-800/80 text-slate-100 border border-slate-700"}`}
            >
              {isLight ? <Moon size={14} /> : <Sun size={14} />}
              {isLight ? "Dark" : "Light"}
            </button>
            <Sparkles size={16} className={isLight ? "text-indigo-500" : "text-indigo-400"} />
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 gap-2">
              <BookOpenText size={32} className="text-slate-700" />
              <p className="text-sm">Upload documents, then ask anything about them.</p>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm whitespace-pre-wrap"
                    : isLight
                    ? "bg-slate-100 text-slate-900 rounded-bl-sm border border-slate-200"
                    : "bg-slate-800/70 text-slate-100 rounded-bl-sm border border-slate-800"
                }`}
              >
                {m.role === "model" ? (
                  <ReactMarkdown className={`${isLight ? "prose break-words" : "prose prose-invert break-words"}`} children={m.text} />
                ) : (
                  m.text
                )}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/60 space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">
                      Sources
                    </p>
                    {m.sources.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-[11px] text-slate-400"
                      >
                        {fileIcon(s.filename)}
                        <span className="truncate">{s.filename}</span>
                        <span className="ml-auto font-mono text-indigo-300">
                          {(s.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="flex justify-start">
              <div className={`rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 text-[13px] ${isLight ? "bg-slate-100 border border-slate-200 text-slate-500" : "bg-slate-800/70 border border-slate-800 text-slate-400"}`}>
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 thinking-dot" />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-indigo-400 thinking-dot"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-indigo-400 thinking-dot"
                    style={{ animationDelay: "0.3s" }}
                  />
                </span>
                Thinking…
              </div>
            </div>
          )}
        </div>

        <div className={`px-6 py-4 border-t ${isLight ? "border-slate-200" : "border-slate-800/80"}`}>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askQuestion();
                }
              }}
              disabled={thinking}
              rows={1}
              placeholder="Ask a question about your documents…"
              className={`flex-1 resize-none rounded-xl px-4 py-3 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-indigo-500/60 disabled:opacity-50 ${isLight ? "bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400" : "bg-slate-800/60 border border-slate-700 text-slate-100 placeholder:text-slate-500"}`}
            />
            <button
              onClick={askQuestion}
              disabled={thinking || !input.trim()}
              className="shrink-0 h-11 w-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 flex items-center justify-center transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  isLight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  isLight: boolean;
}) {
  return (
    <div className={`rounded-lg px-2.5 py-2 ${isLight ? "bg-slate-100 border border-slate-200" : "bg-slate-800/40 border border-slate-800"}`}>
      <div className={`flex items-center gap-1 text-[10px] ${isLight ? "text-slate-500" : "text-slate-500"}`}>
        {icon} {label}
      </div>
      <p className={`text-[13px] font-mono mt-0.5 ${isLight ? "text-slate-900" : "text-slate-200"}`}>{value}</p>
    </div>
  );
}
