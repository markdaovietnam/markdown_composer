"use client";

import { useState, useRef, useCallback, useEffect, createElement, Suspense, lazy } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const RichTextEditor = lazy(() => import("@/components/RichTextEditor"));
const RewriteDialog = lazy(() => import("@/components/RewriteDialog"));
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
  id: string;
  content: string;
  size: number;
  name?: string;
}

interface CommentItem {
  id: string;
  authorEmail: string;
  text: string;
  createdAt: number;
  resolved: boolean;
}

interface Collaborator {
  userId: string;
  email: string;
  lastSeen: number;
}

interface DocPage {
  name: string;
  content: string;
}

const PAGE_RE = /<!--page:(.*?)-->/g;

function parsePages(content: string): DocPage[] {
  const matches = [...content.matchAll(PAGE_RE)];
  if (matches.length === 0) {
    return [{ name: "Page 1", content }];
  }
  const pages: DocPage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;
    let pageContent = content.slice(start, end);
    pageContent = pageContent.replace(/^\n+/, "");
    pages.push({ name: matches[i][1] || `Page ${i + 1}`, content: pageContent });
  }
  return pages;
}

function serializePages(pages: DocPage[]): string {
  if (pages.length === 1) {
    return pages[0].content;
  }
  return pages.map((p) => `<!--page:${p.name}-->\n${p.content}`).join("\n");
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

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

export default function EditPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>Loading...</div>}>
      <Editor />
    </Suspense>
  );
}

function Editor() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileParam = searchParams.get("file");
  const ownerParam = searchParams.get("owner");
  const sessionUserId = session?.user?.id;
  const ownerId = ownerParam || sessionUserId || "";
  const isShared = !!ownerParam && ownerParam !== sessionUserId;

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
  // True from the moment an edit is made until the network save actually completes —
  // guards against the poll sync overwriting local content with stale server data
  // while a save is still in flight (debounce window + request latency).
  const pendingSaveRef = useRef(false);
  const lastSavedContentRef = useRef<string | null>(null);
  const fileRef = useRef<MarkdownFile | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{ timestamp: number; content: string } | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const [rewriteState, setRewriteState] = useState<{
    text: string;
    position: { x: number; y: number };
    selStart?: number;
    selEnd?: number;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [pages, setPages] = useState<DocPage[]>([]);
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [pageCtxMenu, setPageCtxMenu] = useState<{ x: number; y: number; idx: number } | null>(null);

  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [remoteUpdateNotice, setRemoteUpdateNotice] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const filePathStable = file ? (file.path || file.name) : null;

  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" || !sessionUserId) return;
    (async () => {
      try {
        if (fileParam) {
          const res = await fetch(`/api/collab?owner=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(fileParam)}`);
          if (!res.ok) { setLoading(false); return; }
          const target: MarkdownFile = await res.json();
          setFile(target);
          setPages(parsePages(target.content));
          setActivePageIdx(0);
        } else {
          const res = await fetch("/api/files");
          if (res.ok) {
            const data: MarkdownFile[] = await res.json();
            const target = data[0];
            if (target) {
              setFile(target);
              setPages(parsePages(target.content));
              setActivePageIdx(0);
            }
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [status, fileParam, ownerId, sessionUserId]);

  // Clamp active page index if pages shrink (e.g. from a remote update)
  useEffect(() => {
    if (pages.length > 0 && activePageIdx >= pages.length) {
      setActivePageIdx(pages.length - 1);
    }
  }, [pages, activePageIdx]);

  const saveToBlob = useCallback(async (path: string, content: string) => {
    setSaving(true);
    try {
      await fetch("/api/collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: ownerId, path, content }),
      });
      lastSavedContentRef.current = content;
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
      pendingSaveRef.current = false;
    }
  }, [ownerId]);

  const [savingVersion, setSavingVersion] = useState(false);

  const commitPages = useCallback((nextPages: DocPage[]) => {
    const serialized = serializePages(nextPages);
    setPages(nextPages);
    setFile((prev) => prev ? { ...prev, content: serialized } : prev);
    pendingSaveRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const f = fileRef.current;
      if (f) saveToBlob(f.path || f.name, serialized);
      else pendingSaveRef.current = false;
    }, 1000);
  }, [saveToBlob]);

  const updateContent = useCallback((content: string) => {
    setPages((prev) => {
      const next = [...prev];
      if (!next[activePageIdx]) return prev;
      next[activePageIdx] = { ...next[activePageIdx], content };
      const serialized = serializePages(next);
      setFile((f) => f ? { ...f, content: serialized } : f);
      pendingSaveRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const f = fileRef.current;
        if (f) saveToBlob(f.path || f.name, serialized);
        else pendingSaveRef.current = false;
      }, 1000);
      return next;
    });
  }, [activePageIdx, saveToBlob]);

  const addPage = useCallback(() => {
    const nextPages = [...pages, { name: `Page ${pages.length + 1}`, content: "" }];
    commitPages(nextPages);
    setActivePageIdx(nextPages.length - 1);
  }, [pages, commitPages]);

  const deletePage = useCallback((idx: number) => {
    if (pages.length <= 1) return;
    const nextPages = pages.filter((_, i) => i !== idx);
    commitPages(nextPages);
    setActivePageIdx((prev) => Math.max(0, prev >= nextPages.length ? nextPages.length - 1 : (prev > idx ? prev - 1 : prev)));
  }, [pages, commitPages]);

  const renamePage = useCallback((idx: number) => {
    const name = window.prompt("Page name:", pages[idx]?.name || "");
    if (!name || !name.trim()) return;
    const nextPages = pages.map((p, i) => (i === idx ? { ...p, name: name.trim() } : p));
    commitPages(nextPages);
  }, [pages, commitPages]);

  const movePage = useCallback((idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    const nextPages = [...pages];
    [nextPages[idx], nextPages[target]] = [nextPages[target], nextPages[idx]];
    commitPages(nextPages);
    setActivePageIdx(target);
  }, [pages, commitPages]);

  const fetchVersions = useCallback(async () => {
    if (!filePathStable) return;
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/versions?file=${encodeURIComponent(filePathStable)}&owner=${encodeURIComponent(ownerId)}`);
      if (res.ok) setVersions(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingVersions(false);
    }
  }, [filePathStable, ownerId]);

  const createVersion = useCallback(async () => {
    if (!file || !filePathStable) return;
    const name = window.prompt("Version name (optional):", "") ?? "";
    if (name === null) return;
    setSavingVersion(true);
    try {
      await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: filePathStable, content: file.content, name: name.trim(), owner: ownerId }),
      });
      if (showVersions) fetchVersions();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingVersion(false);
    }
  }, [file, filePathStable, ownerId, showVersions, fetchVersions]);

  const renameVersion = useCallback(async (v: Version) => {
    if (!filePathStable) return;
    const name = window.prompt("Rename version:", v.name || "");
    if (name === null) return;
    try {
      await fetch("/api/versions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: v.id, name: name.trim() }),
      });
      fetchVersions();
    } catch (err) {
      console.error(err);
    }
  }, [filePathStable, ownerId, fetchVersions]);

  const toggleVersions = useCallback(() => {
    const next = !showVersions;
    setShowVersions(next);
    setShowComments(false);
    setPreviewVersion(null);
    if (next) fetchVersions();
  }, [showVersions, fetchVersions]);

  const previewVersionContent = useCallback(async (v: Version) => {
    if (previewVersion?.timestamp === v.timestamp) {
      setPreviewVersion(null);
      return;
    }
    setPreviewVersion({ timestamp: v.timestamp, content: v.content });
  }, [previewVersion]);

  const restoreVersion = useCallback(async (v: Version) => {
    if (!filePathStable) return;
    setRestoringVersion(true);
    pendingSaveRef.current = true;
    try {
      const content = v.content;
      await fetch("/api/collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: ownerId, path: filePathStable, content }),
      });
      await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: filePathStable, content, owner: ownerId }),
      });
      lastSavedContentRef.current = content;
      setFile((prev) => prev ? { ...prev, content } : prev);
      setPages(parsePages(content));
      setActivePageIdx(0);
      setPreviewVersion(null);
      setShowVersions(false);
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringVersion(false);
      pendingSaveRef.current = false;
    }
  }, [filePathStable, ownerId]);

  // Presence heartbeat + collaborator list
  useEffect(() => {
    if (!filePathStable || !ownerId) return;
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: ownerId, path: filePathStable }),
        });
        const res = await fetch(`/api/presence?owner=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(filePathStable)}`);
        if (res.ok && !cancelled) setCollaborators(await res.json());
      } catch {
        /* ignore */
      }
    };
    heartbeat();
    const interval = setInterval(heartbeat, 4000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [filePathStable, ownerId]);

  // Near-realtime content sync: poll for remote changes every 3s
  useEffect(() => {
    if (!filePathStable || !ownerId) return;
    let cancelled = false;
    const poll = async () => {
      // Skip while a local edit is debouncing or its save is still in flight —
      // otherwise a stale fetch can land after the debounce clears but before
      // the write reaches the server, wiping out the just-typed content.
      if (pendingSaveRef.current) return;
      try {
        const res = await fetch(`/api/collab?owner=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(filePathStable)}`);
        if (!res.ok || cancelled) return;
        const latest: MarkdownFile = await res.json();
        if (pendingSaveRef.current) return; // typing may have started while this request was in flight
        const current = fileRef.current;
        if (!current || latest.content === current.content) return;
        setFile({ ...current, content: latest.content });
        setPages(parsePages(latest.content));
        setRemoteUpdateNotice(true);
        setTimeout(() => setRemoteUpdateNotice(false), 2500);
      } catch {
        /* ignore */
      }
    };
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [filePathStable, ownerId]);

  // Comments
  const fetchComments = useCallback(async () => {
    if (!filePathStable || !ownerId) return;
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/comments?owner=${encodeURIComponent(ownerId)}&path=${encodeURIComponent(filePathStable)}`);
      if (res.ok) setComments(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingComments(false);
    }
  }, [filePathStable, ownerId]);

  useEffect(() => {
    if (filePathStable && ownerId) fetchComments();
  }, [filePathStable, ownerId, fetchComments]);

  const toggleComments = useCallback(() => {
    const next = !showComments;
    setShowComments(next);
    setShowVersions(false);
    if (next) fetchComments();
  }, [showComments, fetchComments]);

  const addComment = useCallback(async () => {
    if (!newComment.trim() || !filePathStable || !ownerId) return;
    setPostingComment(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: ownerId, path: filePathStable, text: newComment.trim() }),
      });
      if (res.ok) {
        setNewComment("");
        fetchComments();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPostingComment(false);
    }
  }, [newComment, filePathStable, ownerId, fetchComments]);

  const setCommentResolved = useCallback(async (id: string, resolved: boolean) => {
    if (!filePathStable || !ownerId) return;
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved } : c)));
    try {
      await fetch("/api/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: ownerId, path: filePathStable, id, resolved }),
      });
    } catch (err) {
      console.error(err);
    }
  }, [filePathStable, ownerId]);

  const deleteComment = useCallback(async (id: string) => {
    if (!filePathStable || !ownerId) return;
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch("/api/comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: ownerId, path: filePathStable, id }),
      });
    } catch (err) {
      console.error(err);
    }
  }, [filePathStable, ownerId]);

  const activePageContent = pages[activePageIdx]?.content ?? "";

  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const lineEl = target.closest("[data-line]");
    if (!lineEl || !editorRef.current) return;
    const line = parseInt(lineEl.getAttribute("data-line") || "0", 10);
    const lines = activePageContent.split("\n");
    let pos = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) pos += lines[i].length + 1;
    editorRef.current.focus();
    editorRef.current.setSelectionRange(pos, pos);
    editorRef.current.scrollTop = Math.max(0, line * 24 - 100);
  }, [activePageContent]);

  const makeComponent = useCallback((tag: string) => {
    return function TrackedComponent(props: Record<string, unknown>) {
      const idx = elementIndexRef.current++;
      const sourceLine = findSourceLine(activePageContent, tag, idx);
      const { node, children, ...rest } = props as Record<string, unknown> & { node?: unknown; children?: React.ReactNode };
      void node; void rest;
      return createElement(tag, { "data-line": sourceLine }, children);
    };
  }, [activePageContent]);

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

  const unresolvedCount = comments.filter((c) => !c.resolved).length;
  const visibleComments = comments.filter((c) => showResolved || !c.resolved);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div className="editor-topbar">
        <button className="btn-ghost btn" onClick={() => router.push("/")} style={{ padding: "6px 12px", fontSize: 13 }}>
          ← All Files
        </button>
        <span className="editor-filename">{file.name}</span>
        {isShared && <span className="shared-badge">Shared</span>}
        {saving && <span style={{ fontSize: 12, color: "var(--foreground-muted)" }}>Saving...</span>}
        {remoteUpdateNotice && <span className="remote-update-badge">Updated by collaborator</span>}
        {collaborators.length > 0 && (
          <div className="collab-avatars" title={collaborators.map((c) => c.email).join(", ")}>
            {collaborators.slice(0, 4).map((c) => (
              <div key={c.userId} className="collab-avatar">{initials(c.email)}</div>
            ))}
          </div>
        )}
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
          <button className={`btn-ghost btn${showComments ? " vh-active" : ""}`} onClick={toggleComments} style={{ padding: "5px 12px", fontSize: 12, position: "relative" }}>
            💬 Comments
            {unresolvedCount > 0 && <span className="comment-badge">{unresolvedCount}</span>}
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="page-tabs" onClick={() => setPageCtxMenu(null)}>
        {pages.map((p, i) => (
          <div
            key={i}
            className={`page-tab ${i === activePageIdx ? "active" : ""}`}
            onClick={() => setActivePageIdx(i)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPageCtxMenu({ x: e.clientX, y: e.clientY, idx: i }); }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="page-tab-name">{p.name}</span>
          </div>
        ))}
        <button className="page-tab-add" onClick={addPage} title="Add page">+ Page</button>
      </div>

      {pageCtxMenu && (
        <div className="db-ctx-menu" style={{ top: pageCtxMenu.y, left: pageCtxMenu.x }} onClick={(e) => e.stopPropagation()}>
          <button className="db-ctx-btn" onClick={() => { renamePage(pageCtxMenu.idx); setPageCtxMenu(null); }}>Rename</button>
          <button className="db-ctx-btn" disabled={pageCtxMenu.idx === 0} onClick={() => { movePage(pageCtxMenu.idx, -1); setPageCtxMenu(null); }}>Move left</button>
          <button className="db-ctx-btn" disabled={pageCtxMenu.idx === pages.length - 1} onClick={() => { movePage(pageCtxMenu.idx, 1); setPageCtxMenu(null); }}>Move right</button>
          <div className="db-ctx-sep" />
          <button className="db-ctx-btn db-ctx-danger" disabled={pages.length <= 1} onClick={() => { deletePage(pageCtxMenu.idx); setPageCtxMenu(null); }}>Delete page</button>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {mode === "markdown" ? (
            <div className="main-area" style={{ flex: 1 }}>
              <div className="editor-pane">
                <div className="pane-header">Markdown</div>
                <textarea
                  ref={editorRef}
                  className="editor-textarea"
                  value={activePageContent}
                  onChange={(e) => updateContent(e.target.value)}
                  placeholder="Write your markdown here..."
                  spellCheck={false}
                  onContextMenu={(e) => {
                    const ta = editorRef.current;
                    if (!ta) return;
                    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
                    if (sel.trim()) {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY });
                    }
                  }}
                />
              </div>
              <div className="preview-pane">
                <div className="pane-header">Preview</div>
                <div className="preview-content" onClick={handlePreviewClick}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
                    {activePageContent}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <Suspense fallback={<div style={{ padding: 20 }}>Loading editor...</div>}>
                <RichTextEditor key={activePageIdx} content={activePageContent} onChange={updateContent} onContextMenu={(e) => {
                  const sel = window.getSelection()?.toString() || "";
                  if (sel.trim()) {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY });
                  }
                }} />
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
              <div className="vh-empty">No versions yet. Click &quot;Save Version&quot; to create a snapshot.</div>
            ) : (
              <div className="vh-list">
                {versions.map((v) => {
                  const date = new Date(v.timestamp);
                  const isActive = previewVersion?.timestamp === v.timestamp;
                  return (
                    <div key={v.timestamp} className={`vh-item${isActive ? " vh-item-active" : ""}`}>
                      <button className="vh-item-btn" onClick={() => previewVersionContent(v)}>
                        <div className="vh-item-info">
                          {v.name && <span className="vh-item-name">{v.name}</span>}
                          <span className="vh-item-date">
                            {date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            {" "}
                            {date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <span className="vh-item-size">{(v.size / 1024).toFixed(1)} KB</span>
                      </button>
                      {isActive && (
                        <div className="vh-item-actions">
                          <button className="btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => restoreVersion(v)} disabled={restoringVersion}>
                            {restoringVersion ? "Restoring..." : "Restore"}
                          </button>
                          <button className="btn-ghost btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => renameVersion(v)}>
                            Rename
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

        {showComments && (
          <div className="vh-panel cm-panel">
            <div className="vh-header">
              <span className="vh-title">Comments</span>
              <button className="vh-close" onClick={() => setShowComments(false)}>✕</button>
            </div>

            <div className="cm-composer">
              <textarea
                className="cm-input"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addComment(); }
                }}
              />
              <button className="btn" style={{ fontSize: 11, padding: "5px 12px", alignSelf: "flex-end" }} onClick={addComment} disabled={postingComment || !newComment.trim()}>
                {postingComment ? "Posting..." : "Post"}
              </button>
            </div>

            <div className="cm-filter">
              <label className="cm-filter-label">
                <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
                Show resolved
              </label>
            </div>

            {loadingComments ? (
              <div className="vh-loading">Loading comments...</div>
            ) : visibleComments.length === 0 ? (
              <div className="vh-empty">No comments yet.</div>
            ) : (
              <div className="vh-list">
                {visibleComments.map((c) => (
                  <div key={c.id} className={`cm-item${c.resolved ? " cm-item-resolved" : ""}`}>
                    <div className="cm-item-header">
                      <span className="cm-item-author">{c.authorEmail}</span>
                      <span className="cm-item-date">{new Date(c.createdAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="cm-item-text">{c.text}</div>
                    <div className="cm-item-actions">
                      {c.resolved ? (
                        <button className="btn-ghost btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setCommentResolved(c.id, false)}>
                          Reopen
                        </button>
                      ) : (
                        <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setCommentResolved(c.id, true)}>
                          ✓ Resolve
                        </button>
                      )}
                      <button className="db-ctx-danger" style={{ fontSize: 11, padding: "3px 8px", background: "none", border: "none", cursor: "pointer" }} onClick={() => deleteComment(c.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context menu for rewrite */}
      {ctxMenu && (
        <div
          className="db-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="db-ctx-btn" onClick={() => {
            const ta = editorRef.current;
            if (ta) {
              const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
              if (sel.trim()) {
                setRewriteState({
                  text: sel,
                  position: { x: ctxMenu.x, y: ctxMenu.y },
                  selStart: ta.selectionStart,
                  selEnd: ta.selectionEnd,
                });
              }
            } else {
              const sel = window.getSelection()?.toString() || "";
              if (sel.trim()) {
                setRewriteState({
                  text: sel,
                  position: { x: ctxMenu.x, y: ctxMenu.y },
                });
              }
            }
            setCtxMenu(null);
          }}>
            ✨ Rewrite with AI
          </button>
        </div>
      )}

      {/* Rewrite dialog */}
      {rewriteState && (
        <Suspense fallback={null}>
          <RewriteDialog
            selectedText={rewriteState.text}
            position={rewriteState.position}
            onClose={() => setRewriteState(null)}
            onRewrite={(newText) => {
              if (mode === "markdown" && rewriteState.selStart !== undefined && rewriteState.selEnd !== undefined) {
                const before = activePageContent.substring(0, rewriteState.selStart);
                const after = activePageContent.substring(rewriteState.selEnd);
                updateContent(before + newText + after);
              } else {
                const updated = activePageContent.replace(rewriteState.text, newText);
                updateContent(updated);
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
