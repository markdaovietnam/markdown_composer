"use client";

import { useState, useRef, useCallback, useEffect, createElement, Suspense, lazy } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const RichTextEditor = lazy(() => import("@/components/RichTextEditor"));
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownFile {
  id: string;
  name: string;
  path?: string;
  content: string;
  url?: string;
}

interface Version {
  timestamp: number;
  url: string;
  size: number;
}

function findSourceLine(content: string, tag: string, index: number): number {
  const lines = content.split("\n");
  let count = 0;
  const prefixMap: Record<string, string[]> = {
    h1: ["# "], h2: ["## "], h3: ["### "], h4: ["#### "],
    blockquote: [">"], hr: ["---", "***", "___"], pre: ["\`\`\`"],
  };
  const prefixes = prefixMap[tag];
  if (prefixes) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (tag === "h2" && trimmed.startsWith("### ")) continue;
      if (tag === "h3" && trimmed.startsWith("#### ")) continue;
      if (tag === "h1" && trimmed.startsWith("## ")) continue;
      if (prefixes.some((p) => trimmed.startsWith(p))) {
        if (count === index) return i;
        count++;
      }
    }
    return 0;
  }
  if (tag === "li") {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        if (count === index) return i;
        count++;
      }
    }
    return 0;
  }
  if (tag === "p") {
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("\`\`\`")) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;
      if (trimmed !== "" && !trimmed.startsWith("#") && !trimmed.startsWith(">") &&
        !/^[-*+]\s/.test(trimmed) && !/^\d+\.\s/.test(trimmed) &&
        !trimmed.startsWith("|") && !["---", "***", "___"].some((s) => trimmed.startsWith(s))) {
        if (count === index) return i;
        count++;
      }
    }
  }
  return 0;
}

export default function EditPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>Loading...</div>}>
      <Editor />
    </Suspense>
  );
}

function Editor() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileParam = searchParams.get("file");
  const [file, setFile] = useState<MarkdownFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"markdown" | "richtext">(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("editor-mode") as "markdown" | "richtext") || "markdown";
    return "markdown";
  });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const elementIndexRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{ timestamp: number; content: string } | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      try {
        const res = await fetch("/api/files");
        if (!res.ok) return;
        const data: MarkdownFile[] = await res.json();
        const target = fileParam ? data.find((f) => f.path === fileParam || f.id === fileParam) : data[0];
        if (target) setFile(target);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [status, fileParam]);

  const saveToBlob = useCallback(async (name: string, content: string) => {
    setSaving(true);
    try {
      await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, []);

  const [savingVersion, setSavingVersion] = useState(false);

  const updateContent = useCallback((content: string) => {
    setFile((prev) => prev ? { ...prev, content } : prev);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (file) saveToBlob(file.path || file.name, content);
    }, 1000);
  }, [file, saveToBlob]);

  const fetchVersions = useCallback(async () => {
    if (!file) return;
    setLoadingVersions(true);
    try {
      const filePath = file.path || file.name;
      const res = await fetch(`/api/versions?file=${encodeURIComponent(filePath)}`);
      if (res.ok) setVersions(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingVersions(false);
    }
  }, [file]);

  const createVersion = useCallback(async () => {
    if (!file) return;
    setSavingVersion(true);
    try {
      const filePath = file.path || file.name;
      await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content: file.content }),
      });
      if (showVersions) fetchVersions();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingVersion(false);
    }
  }, [file, showVersions, fetchVersions]);

  const toggleVersions = useCallback(() => {
    const next = !showVersions;
    setShowVersions(next);
    setPreviewVersion(null);
    if (next) fetchVersions();
  }, [showVersions, fetchVersions]);

  const previewVersionContent = useCallback(async (v: Version) => {
    if (previewVersion?.timestamp === v.timestamp) {
      setPreviewVersion(null);
      return;
    }
    try {
      const res = await fetch(v.url);
      const content = await res.text();
      setPreviewVersion({ timestamp: v.timestamp, content });
    } catch (err) {
      console.error(err);
    }
  }, [previewVersion]);

  const restoreVersion = useCallback(async (v: Version) => {
    if (!file) return;
    setRestoringVersion(true);
    try {
      const res = await fetch(v.url);
      const content = await res.text();
      const filePath = file.path || file.name;
      await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: filePath, content }),
      });
      await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content }),
      });
      setFile((prev) => prev ? { ...prev, content } : prev);
      setPreviewVersion(null);
      setShowVersions(false);
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringVersion(false);
    }
  }, [file]);

  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const lineEl = target.closest("[data-line]");
    if (!lineEl || !editorRef.current || !file) return;
    const line = parseInt(lineEl.getAttribute("data-line") || "0", 10);
    const lines = file.content.split("\n");
    let pos = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) pos += lines[i].length + 1;
    editorRef.current.focus();
    editorRef.current.setSelectionRange(pos, pos);
    editorRef.current.scrollTop = Math.max(0, line * 24 - 100);
  }, [file]);

  const makeComponent = useCallback((tag: string) => {
    return function TrackedComponent(props: Record<string, unknown>) {
      const idx = elementIndexRef.current++;
      const sourceLine = findSourceLine(file?.content || "", tag, idx);
      const { node, children, ...rest } = props as Record<string, unknown> & { node?: unknown; children?: React.ReactNode };
      void node; void rest;
      return createElement(tag, { "data-line": sourceLine }, children);
    };
  }, [file?.content]);

  if (status === "loading" || status === "unauthenticated" || loading) {
    return <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  }

  if (!file) {
    return <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>File not found</div>;
  }

  elementIndexRef.current = 0;
  const components = {
    h1: makeComponent("h1"), h2: makeComponent("h2"), h3: makeComponent("h3"), h4: makeComponent("h4"),
    p: makeComponent("p"), li: makeComponent("li"), blockquote: makeComponent("blockquote"),
    pre: makeComponent("pre"), hr: makeComponent("hr"),
  };

  const switchMode = (m: "markdown" | "richtext") => {
    setMode(m);
    localStorage.setItem("editor-mode", m);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div className="editor-topbar">
        <button className="btn-ghost btn" onClick={() => router.push("/")} style={{ padding: "6px 12px", fontSize: 13 }}>
          ← All Files
        </button>
        <span className="editor-filename">{file.name}</span>
        {saving && <span style={{ fontSize: 12, color: "var(--foreground-muted)" }}>Saving...</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mode-toggle">
            <button className={mode === "markdown" ? "active" : ""} onClick={() => switchMode("markdown")}>Markdown</button>
            <button className={mode === "richtext" ? "active" : ""} onClick={() => switchMode("richtext")}>Rich Text</button>
          </div>
          <button className="btn" onClick={createVersion} disabled={savingVersion} style={{ padding: "5px 12px", fontSize: 12 }}>
            {savingVersion ? "Saving..." : "💾 Save Version"}
          </button>
          <button className={`btn-ghost btn${showVersions ? " vh-active" : ""}`} onClick={toggleVersions} style={{ padding: "5px 12px", fontSize: 12 }}>
            ⏱ History
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {mode === "markdown" ? (
            <div className="main-area" style={{ flex: 1 }}>
              <div className="editor-pane">
                <div className="pane-header">Markdown</div>
                <textarea
                  ref={editorRef}
                  className="editor-textarea"
                  value={file.content}
                  onChange={(e) => updateContent(e.target.value)}
                  placeholder="Write your markdown here..."
                  spellCheck={false}
                />
              </div>
              <div className="preview-pane">
                <div className="pane-header">Preview</div>
                <div className="preview-content" onClick={handlePreviewClick}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
                    {file.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <Suspense fallback={<div style={{ padding: 20 }}>Loading editor...</div>}>
                <RichTextEditor content={file.content} onChange={updateContent} />
              </Suspense>
            </div>
          )}
        </div>

        {showVersions && (
          <div className="vh-panel">
            <div className="vh-header">
              <span className="vh-title">Version History</span>
              <button className="vh-close" onClick={() => { setShowVersions(false); setPreviewVersion(null); }}>✕</button>
            </div>
            {loadingVersions ? (
              <div className="vh-loading">Loading versions...</div>
            ) : versions.length === 0 ? (
              <div className="vh-empty">No versions yet. Versions are saved automatically when you edit.</div>
            ) : (
              <div className="vh-list">
                {versions.map((v) => {
                  const date = new Date(v.timestamp);
                  const isActive = previewVersion?.timestamp === v.timestamp;
                  return (
                    <div key={v.timestamp} className={`vh-item${isActive ? " vh-item-active" : ""}`}>
                      <button className="vh-item-btn" onClick={() => previewVersionContent(v)}>
                        <span className="vh-item-date">{date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                        <span className="vh-item-time">{date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                        <span className="vh-item-size">{(v.size / 1024).toFixed(1)} KB</span>
                      </button>
                      {isActive && (
                        <div className="vh-item-actions">
                          <button className="btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => restoreVersion(v)} disabled={restoringVersion}>
                            {restoringVersion ? "Restoring..." : "Restore this version"}
                          </button>
                        </div>
                      )}
                      {isActive && previewVersion && (
                        <div className="vh-preview">
                          <div className="vh-preview-label">Preview</div>
                          <pre className="vh-preview-content">{previewVersion.content}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
