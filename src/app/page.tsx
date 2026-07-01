"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

interface FileItem {
  id: string;
  name: string;
  path: string;
  content: string;
}

interface FolderEntry {
  type: "folder";
  name: string;
  path: string;
  itemCount: number;
}

interface FileEntry {
  type: "file";
  name: string;
  path: string;
  size: string;
}

type Entry = FolderEntry | FileEntry;

function formatSize(content: string) {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getEntriesForFolder(files: FileItem[], currentPath: string): Entry[] {
  const entries: Entry[] = [];
  const seenFolders = new Set<string>();
  const prefix = currentPath ? currentPath + "/" : "";

  // First pass: detect folders from all files (including .folder markers)
  for (const file of files) {
    const path = file.path;
    if (!currentPath && path.includes("/")) {
      const folderName = path.split("/")[0];
      if (!seenFolders.has(folderName)) {
        seenFolders.add(folderName);
        const count = files.filter((f) => f.path.startsWith(folderName + "/") && !f.path.endsWith("/.folder")).length;
        entries.push({ type: "folder", name: folderName, path: folderName, itemCount: count });
      }
    } else if (currentPath && path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) {
        const folderName = rest.split("/")[0];
        if (!seenFolders.has(folderName)) {
          seenFolders.add(folderName);
          const folderPath = prefix + folderName;
          const count = files.filter((f) => f.path.startsWith(folderPath + "/") && !f.path.endsWith("/.folder")).length;
          entries.push({ type: "folder", name: folderName, path: folderPath, itemCount: count });
        }
      }
    }
  }

  // Second pass: add files (not .folder markers)
  for (const file of files) {
    if (file.path.endsWith("/.folder")) continue;
    if (!currentPath && !file.path.includes("/")) {
      entries.push({ type: "file", name: file.name, path: file.path, size: formatSize(file.content) });
    } else if (currentPath && file.path.startsWith(prefix)) {
      const rest = file.path.slice(prefix.length);
      if (!rest.includes("/")) {
        entries.push({ type: "file", name: file.name, path: file.path, size: formatSize(file.content) });
      }
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState("");
  const [view, setView] = useState<"files" | "shared">("files");
  const [sharedFiles, setSharedFiles] = useState<{ fromEmail: string; fileName: string; filePath: string; fromUserId: string; sharedAt: number }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [shareModal, setShareModal] = useState<{ path: string; name: string } | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareStatus, setShareStatus] = useState<{ type: "ok" | "error"; msg: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      if (!res.ok) return;
      setFiles(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSharedFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/share");
      if (res.ok) setSharedFiles(await res.json());
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") { fetchFiles(); fetchSharedFiles(); }
  }, [status, fetchFiles, fetchSharedFiles]);

  useEffect(() => {
    if (renaming && renameRef.current) { renameRef.current.focus(); renameRef.current.select(); }
  }, [renaming]);

  useEffect(() => {
    if (creatingFolder && folderRef.current) folderRef.current.focus();
  }, [creatingFolder]);

  const entries = getEntriesForFolder(files, currentPath);

  const breadcrumbs = [{ name: "All files", path: "" }];
  if (currentPath) {
    const parts = currentPath.split("/");
    for (let i = 0; i < parts.length; i++) {
      breadcrumbs.push({ name: parts[i], path: parts.slice(0, i + 1).join("/") });
    }
  }

  const toggleSelect = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey || e.metaKey) {
        next.has(path) ? next.delete(path) : next.add(path);
      } else {
        next.clear();
        next.add(path);
      }
      return next;
    });
  };

  const deleteEntry = async (entry: Entry) => {
    if (entry.type === "file") {
      await fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: entry.path }),
      });
    } else {
      const toDelete = files.filter((f) => f.path.startsWith(entry.path + "/"));
      await Promise.all(toDelete.map((f) =>
        fetch("/api/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: f.path }) })
      ));
    }
    fetchFiles();
    setSelected(new Set());
  };

  const startRename = (path: string, name: string) => {
    setRenaming(path);
    setRenameValue(name.replace(/\.md$/, ""));
    setContextMenu(null);
  };

  const finishRename = async () => {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return; }
    const file = files.find((f) => f.path === renaming);
    if (!file) { setRenaming(null); return; }

    let newName = renameValue.trim();
    if (!newName.endsWith(".md")) newName += ".md";
    const parts = renaming.split("/");
    parts[parts.length - 1] = newName;
    const newPath = parts.join("/");
    if (newPath === renaming) { setRenaming(null); return; }

    await fetch("/api/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: renaming, newPath }),
    });
    setRenaming(null);
    fetchFiles();
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) { setCreatingFolder(false); return; }
    const folderPath = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `${folderPath}/.folder`, content: "" }),
    });
    setCreatingFolder(false);
    setNewFolderName("");
    fetchFiles();
  };

  const createFile = async () => {
    const name = `Untitled-${files.length + 1}.md`;
    const path = currentPath ? `${currentPath}/${name}` : name;
    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path, content: "# New Document\n\nStart writing...\n" }),
    });
    setShowCreateMenu(false);
    fetchFiles();
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".md") || f.name.endsWith(".markdown") || f.name.endsWith(".txt")
    );
    for (const f of droppedFiles) {
      const content = await f.text();
      const name = f.name.endsWith(".md") ? f.name : f.name + ".md";
      const path = currentPath ? `${currentPath}/${name}` : name;
      await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, path, content }),
      });
    }
    fetchFiles();
  }, [currentPath, fetchFiles]);

  const downloadFile = (entry: FileEntry) => {
    const file = files.find((f) => f.path === entry.path);
    if (!file) return;
    const blob = new Blob([file.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareFile = async () => {
    if (!shareModal || !shareEmail.trim()) return;
    setSharing(true);
    setShareStatus(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: shareEmail.trim(),
          filePath: shareModal.path,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShareStatus({ type: "error", msg: data.error });
      } else {
        setShareStatus({ type: "ok", msg: `Shared with ${shareEmail.trim()}` });
        setShareEmail("");
      }
    } catch {
      setShareStatus({ type: "error", msg: "Failed to share" });
    } finally {
      setSharing(false);
    }
  };

  if (status === "loading" || status === "unauthenticated" || loading) {
    return <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>Loading...</div>;
  }

  return (
    <div
      className="db-container"
      onClick={() => { setContextMenu(null); setShowCreateMenu(false); setSelected(new Set()); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={handleDrop}
    >
      {/* Sidebar */}
      <div className="db-sidebar">
        <div className="db-logo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Markdown Composer</span>
        </div>
        <nav className="db-nav">
          <a className={`db-nav-item ${view === "files" ? "active" : ""}`} onClick={() => { setView("files"); setCurrentPath(""); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
            All files
          </a>
          <a className={`db-nav-item ${view === "shared" ? "active" : ""}`} onClick={() => { setView("shared"); fetchSharedFiles(); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
            Shared with me
            {sharedFiles.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent)" }}>{sharedFiles.length}</span>}
          </a>
        </nav>
        <div className="db-sidebar-footer">
          <ThemeToggle />
          <div className="db-user-info">
            <div className="db-avatar">{session?.user?.email?.[0]?.toUpperCase() || "U"}</div>
            <span className="db-user-email">{session?.user?.email}</span>
          </div>
          <button className="btn-ghost btn" style={{ fontSize: 12, padding: "4px 10px", width: "100%" }} onClick={() => signOut()}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div className="db-main">
        {view === "files" ? (<>
        {/* Toolbar */}
        <div className="db-toolbar">
          <div className="db-toolbar-left">
            <div style={{ position: "relative" }}>
              <button className="db-upload-btn" onClick={(e) => { e.stopPropagation(); setShowCreateMenu(!showCreateMenu); }}>
                Upload / Create ▾
              </button>
              {showCreateMenu && (
                <div className="db-create-menu" onClick={(e) => e.stopPropagation()}>
                  <label className="db-create-item">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Upload files
                    <input type="file" accept=".md,.markdown,.txt" multiple style={{ display: "none" }} onChange={async (e) => {
                      const inputFiles = Array.from(e.target.files || []);
                      for (const f of inputFiles) {
                        const content = await f.text();
                        const name = f.name.endsWith(".md") ? f.name : f.name + ".md";
                        const path = currentPath ? `${currentPath}/${name}` : name;
                        await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, path, content }) });
                      }
                      setShowCreateMenu(false);
                      fetchFiles();
                    }} />
                  </label>
                  <div className="db-create-separator" />
                  <button className="db-create-item" onClick={() => { setCreatingFolder(true); setShowCreateMenu(false); }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z" /></svg>
                    Folder
                  </button>
                  <button className="db-create-item" onClick={createFile}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                    Document
                  </button>
                </div>
              )}
            </div>
            {selected.size > 0 && (
              <button className="btn" style={{ background: "var(--danger)", fontSize: 13, padding: "6px 14px" }}
                onClick={(e) => { e.stopPropagation(); entries.filter((en) => selected.has(en.path)).forEach((en) => deleteEntry(en)); }}>
                Delete ({selected.size})
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="db-breadcrumb">
          {breadcrumbs.map((b, i) => (
            <span key={b.path}>
              {i > 0 && <span className="db-breadcrumb-sep">/</span>}
              <button
                className={`db-breadcrumb-btn ${i === breadcrumbs.length - 1 ? "active" : ""}`}
                onClick={(e) => { e.stopPropagation(); setCurrentPath(b.path); }}
              >
                {b.name}
              </button>
            </span>
          ))}
        </div>

        {/* Drop overlay */}
        {dragging && (
          <div className="db-drop-overlay">
            <div className="db-drop-box">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              <p>Drop files here to upload</p>
            </div>
          </div>
        )}

        {/* File table */}
        <div className="db-table-wrap">
          <table className="db-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Name</th>
                <th style={{ width: 120 }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {creatingFolder && (
                <tr className="db-row" onClick={(e) => e.stopPropagation()}>
                  <td>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)" stroke="none" opacity="0.8">
                      <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </td>
                  <td colSpan={2}>
                    <input
                      ref={folderRef}
                      className="rename-input"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onBlur={createFolder}
                      onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setCreatingFolder(false); }}
                      placeholder="Folder name"
                      style={{ maxWidth: 300 }}
                    />
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <tr
                  key={entry.path}
                  className={`db-row ${selected.has(entry.path) ? "db-row-selected" : ""}`}
                  onClick={(e) => toggleSelect(entry.path, e)}
                  onDoubleClick={() => {
                    if (entry.type === "folder") setCurrentPath(entry.path);
                    else window.location.href = `/edit?file=${encodeURIComponent(entry.path)}`;
                  }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
                >
                  <td>
                    {entry.type === "folder" ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)" stroke="none" opacity="0.8">
                        <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.2">
                        <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
                        <path d="M10 2v3h3" />
                      </svg>
                    )}
                  </td>
                  <td>
                    {renaming === entry.path ? (
                      <input
                        ref={renameRef}
                        className="rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={finishRename}
                        onKeyDown={(e) => { if (e.key === "Enter") finishRename(); if (e.key === "Escape") setRenaming(null); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: 400 }}
                      />
                    ) : (
                      <span className="db-filename">{entry.name}</span>
                    )}
                  </td>
                  <td className="db-cell-meta">
                    {entry.type === "file" ? entry.size : `${entry.itemCount} items`}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && !creatingFolder && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
                    This folder is empty. Upload files or create a new document.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>) : (
          /* Shared with me view */
          <div className="db-table-wrap" style={{ paddingTop: 16 }}>
            <div className="db-breadcrumb" style={{ padding: "0 0 12px" }}>
              <span className="db-breadcrumb-btn active">Shared with me</span>
            </div>
            {sharedFiles.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "var(--foreground-muted)" }}>
                No files shared with you yet.
              </div>
            ) : (
              <table className="db-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Name</th>
                    <th>Shared by</th>
                    <th style={{ width: 120 }}>Date</th>
                    <th style={{ width: 100 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sharedFiles.map((sf) => (
                    <tr key={sf.filePath + sf.fromUserId} className="db-row">
                      <td>
                        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.2">
                          <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
                          <path d="M10 2v3h3" />
                        </svg>
                      </td>
                      <td><span className="db-filename">{sf.fileName}</span></td>
                      <td className="db-cell-meta">{sf.fromEmail}</td>
                      <td className="db-cell-meta">{new Date(sf.sharedAt).toLocaleDateString("vi-VN")}</td>
                      <td style={{ display: "flex", gap: 6 }}>
                        <button className="btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => {
                          router.push(`/edit?file=${encodeURIComponent(sf.filePath)}&owner=${encodeURIComponent(sf.fromUserId)}`);
                        }}>
                          Open
                        </button>
                        <button className="btn-ghost btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={async () => {
                          try {
                            const res = await fetch(`/api/collab?path=${encodeURIComponent(sf.filePath)}&owner=${encodeURIComponent(sf.fromUserId)}`);
                            const data = await res.json();
                            const blob = new Blob([data.content || ""], { type: "text/markdown" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = sf.fileName; a.click();
                            URL.revokeObjectURL(url);
                          } catch { /* ignore */ }
                        }}>
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="db-ctx-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={(e) => e.stopPropagation()}>
          {contextMenu.entry.type === "file" && (
            <button className="db-ctx-btn" onClick={() => { window.location.href = `/edit?file=${encodeURIComponent(contextMenu.entry.path)}`; setContextMenu(null); }}>
              Open
            </button>
          )}
          {contextMenu.entry.type === "folder" && (
            <button className="db-ctx-btn" onClick={() => { setCurrentPath(contextMenu.entry.path); setContextMenu(null); }}>
              Open folder
            </button>
          )}
          {contextMenu.entry.type === "file" && (
            <button className="db-ctx-btn" onClick={() => startRename(contextMenu.entry.path, contextMenu.entry.name)}>
              Rename
            </button>
          )}
          {contextMenu.entry.type === "file" && (
            <>
              <button className="db-ctx-btn" onClick={() => { downloadFile(contextMenu.entry as FileEntry); setContextMenu(null); }}>
                Download .md
              </button>
              <button className="db-ctx-btn" onClick={() => {
                const e = contextMenu.entry as FileEntry;
                setShareModal({ path: e.path, name: e.name });
                setContextMenu(null);
              }}>
                Share
              </button>
            </>
          )}
          <div className="db-ctx-sep" />
          <button className="db-ctx-btn db-ctx-danger" onClick={() => { deleteEntry(contextMenu.entry); setContextMenu(null); }}>
            Delete
          </button>
        </div>
      )}

      {/* Share modal */}
      {shareModal && (
        <div className="rw-overlay" onClick={() => { setShareModal(null); setShareStatus(null); setShareEmail(""); }}>
          <div className="rw-dialog" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="rw-header">
              <span className="rw-title">Share &quot;{shareModal.name}&quot;</span>
              <button className="rw-close" onClick={() => { setShareModal(null); setShareStatus(null); setShareEmail(""); }}>✕</button>
            </div>
            <div style={{ padding: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--foreground-muted)" }}>
                Share with (email)
              </label>
              <input
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="user@example.com"
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 6,
                  border: "1px solid var(--border)", background: "var(--surface-200)",
                  color: "var(--foreground)", fontSize: 13, outline: "none",
                  boxSizing: "border-box",
                }}
                onKeyDown={(e) => { if (e.key === "Enter") shareFile(); }}
                autoFocus
              />
              {shareStatus && (
                <div style={{
                  marginTop: 8, fontSize: 12, padding: "6px 10px", borderRadius: 6,
                  background: shareStatus.type === "ok" ? "var(--accent-light)" : "var(--danger-light)",
                  color: shareStatus.type === "ok" ? "var(--accent-text)" : "var(--danger)",
                }}>
                  {shareStatus.msg}
                </div>
              )}
            </div>
            <div className="rw-actions">
              <button className="btn-ghost btn" onClick={() => { setShareModal(null); setShareStatus(null); setShareEmail(""); }} style={{ fontSize: 12 }}>Cancel</button>
              <button className="btn" onClick={shareFile} disabled={sharing || !shareEmail.trim()} style={{ fontSize: 12 }}>
                {sharing ? "Sharing..." : "Share"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
