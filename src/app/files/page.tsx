"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

interface FileItem {
  id: string;
  name: string;
  path: string;
  content: string;
  url: string;
}

interface TreeFolder {
  name: string;
  path: string;
  files: FileItem[];
  folders: TreeFolder[];
}

function buildTree(files: FileItem[]): TreeFolder {
  const root: TreeFolder = { name: "", path: "", files: [], folders: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      let folder = current.folders.find((f) => f.name === folderName);
      if (!folder) {
        folder = {
          name: folderName,
          path: parts.slice(0, i + 1).join("/"),
          files: [],
          folders: [],
        };
        current.folders.push(folder);
      }
      current = folder;
    }
    current.files.push(file);
  }

  return root;
}

function formatSize(content: string) {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function FilesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: "file" | "folder"; path: string; url?: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (status === "authenticated") fetchFiles();
  }, [status, fetchFiles]);

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (newFolderParent !== null && newFolderRef.current) {
      newFolderRef.current.focus();
    }
  }, [newFolderParent]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const toggleSelect = (path: string, e: React.MouseEvent) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey || e.metaKey) {
        next.has(path) ? next.delete(path) : next.add(path);
      } else {
        if (next.size === 1 && next.has(path)) {
          next.clear();
        } else {
          next.clear();
          next.add(path);
        }
      }
      return next;
    });
  };

  const deleteFile = async (url: string, path: string) => {
    await fetch("/api/files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setFiles((prev) => prev.filter((f) => f.path !== path));
    setSelected((prev) => { const n = new Set(prev); n.delete(path); return n; });
  };

  const deleteSelected = async () => {
    const toDelete = files.filter((f) => selected.has(f.path));
    await Promise.all(toDelete.map((f) => deleteFile(f.url, f.path)));
    setSelected(new Set());
  };

  const startRename = (path: string) => {
    const name = path.split("/").pop() || path;
    setRenaming(path);
    setRenameValue(name);
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

    const res = await fetch("/api/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: renaming, newPath, url: file.url }),
    });
    const updated = await res.json();
    setFiles((prev) => prev.map((f) => (f.path === renaming ? updated : f)));
    setRenaming(null);
  };

  const moveFile = async (filePath: string, targetFolder: string) => {
    const file = files.find((f) => f.path === filePath);
    if (!file) return;
    const fileName = filePath.split("/").pop()!;
    const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    if (newPath === filePath) return;

    const res = await fetch("/api/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: filePath, newPath, url: file.url }),
    });
    const updated = await res.json();
    setFiles((prev) => prev.map((f) => (f.path === filePath ? updated : f)));
  };

  const cancelNewFolder = () => {
    setNewFolderParent(null);
    setNewFolderName("");
  };

  const createFolder = async () => {
    if (newFolderParent === null) return;
    if (!newFolderName.trim()) {
      cancelNewFolder();
      return;
    }
    const folderPath = newFolderParent
      ? `${newFolderParent}/${newFolderName.trim()}`
      : newFolderName.trim();

    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: `${folderPath}/.folder`,
        content: "",
      }),
    });

    setExpandedFolders((prev) => new Set(prev).add(folderPath));
    setNewFolderParent(null);
    setNewFolderName("");
    fetchFiles();
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".md") || f.name.endsWith(".markdown") || f.name.endsWith(".txt")
    );
    for (const file of droppedFiles) {
      const content = await file.text();
      const name = file.name.endsWith(".md") ? file.name : file.name + ".md";
      await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
    }
    fetchFiles();
  }, [fetchFiles]);

  const tree = buildTree(files.filter((f) => !f.path.endsWith("/.folder")));

  const folderPaths = ["", ...files
    .map((f) => f.path.split("/").slice(0, -1).join("/"))
    .filter((p) => p !== "")
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort()];

  if (status === "loading" || status === "unauthenticated" || loading) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        Loading...
      </div>
    );
  }

  const renderFolder = (folder: TreeFolder, depth: number = 0): React.ReactNode => {
    const isRoot = depth === 0;
    const isExpanded = isRoot || expandedFolders.has(folder.path);

    return (
      <div key={folder.path || "root"}>
        {!isRoot && (
          <div
            className="fm-row"
            style={{ paddingLeft: depth * 24 }}
            onClick={() => toggleFolder(folder.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: "folder", path: folder.path });
            }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = "var(--accent-light)"; }}
            onDragLeave={(e) => { e.currentTarget.style.background = ""; }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.style.background = "";
              const filePath = e.dataTransfer.getData("text/plain");
              if (filePath) moveFile(filePath, folder.path);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5"
              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}>
              <path d="M6 4l4 4-4 4" />
            </svg>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" stroke="none" style={{ flexShrink: 0 }}>
              <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" opacity="0.2" />
              <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
            </svg>
            <span className="fm-name">{folder.name}</span>
            <span className="fm-meta">{folder.files.length + folder.folders.length} items</span>
          </div>
        )}

        {isExpanded && (
          <>
            {folder.folders.map((sub) => renderFolder(sub, depth + 1))}
            {newFolderParent === folder.path && (
              <div className="fm-row" style={{ paddingLeft: (depth + 1) * 24 }} onClick={(e) => e.stopPropagation()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" stroke="none" style={{ flexShrink: 0 }}>
                  <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" opacity="0.2" />
                </svg>
                <input
                  ref={newFolderRef}
                  className="rename-input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onBlur={createFolder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createFolder();
                    if (e.key === "Escape") cancelNewFolder();
                  }}
                  placeholder="Folder name"
                />
              </div>
            )}
            {folder.files.map((file) => (
              <div
                key={file.path}
                className={`fm-row ${selected.has(file.path) ? "fm-selected" : ""}`}
                style={{ paddingLeft: (isRoot ? 0 : depth + 1) * 24 }}
                onClick={(e) => toggleSelect(file.path, e)}
                onDoubleClick={() => router.push(`/?file=${encodeURIComponent(file.path)}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, type: "file", path: file.path, url: file.url });
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", file.path);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                  <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
                  <path d="M10 2v3h3" />
                </svg>
                {renaming === file.path ? (
                  <input
                    ref={renameRef}
                    className="rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="fm-name">{file.name}</span>
                )}
                <span className="fm-meta">{formatSize(file.content)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      className="fm-container"
      onClick={() => setContextMenu(null)}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={handleDrop}
    >
      {/* Context menu */}
      {contextMenu && (
        <div
          className="fm-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "file" && (
            <>
              <button className="fm-ctx-btn" onClick={() => { router.push(`/?file=${encodeURIComponent(contextMenu.path)}`); }}>
                Open in Editor
              </button>
              <button className="fm-ctx-btn" onClick={() => startRename(contextMenu.path)}>
                Rename
              </button>
              <div className="fm-ctx-separator" />
              <div className="fm-ctx-label">Move to folder</div>
              {folderPaths.map((fp) => (
                <button key={fp || "__root__"} className="fm-ctx-btn fm-ctx-indent"
                  onClick={async () => { await moveFile(contextMenu.path, fp); setContextMenu(null); }}>
                  {fp || "/ (root)"}
                </button>
              ))}
              <div className="fm-ctx-separator" />
              <button className="fm-ctx-btn fm-ctx-danger" onClick={() => { deleteFile(contextMenu.url!, contextMenu.path); setContextMenu(null); }}>
                Delete
              </button>
            </>
          )}
          {contextMenu.type === "folder" && (
            <>
              <button className="fm-ctx-btn" onClick={() => { setNewFolderParent(contextMenu.path); setContextMenu(null); }}>
                New Subfolder
              </button>
            </>
          )}
        </div>
      )}

      {/* Move modal */}
      {moveTarget && (
        <div className="fm-modal-overlay" onClick={() => setMoveTarget(null)}>
          <div className="fm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Move to folder</h3>
            {folderPaths.map((fp) => (
              <button key={fp || "__root__"} className="fm-modal-btn"
                onClick={async () => { await moveFile(moveTarget, fp); setMoveTarget(null); }}>
                {fp || "/ (root)"}
              </button>
            ))}
            <button className="fm-modal-cancel" onClick={() => setMoveTarget(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="fm-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn-ghost btn" onClick={() => router.push("/")} style={{ padding: "6px 10px" }}>
            ← Editor
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>File Manager</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selected.size > 0 && (
            <button className="btn" style={{ background: "var(--danger)", fontSize: 12, padding: "6px 12px" }} onClick={deleteSelected}>
              Delete ({selected.size})
            </button>
          )}
          <button className="btn" onClick={(e) => { e.stopPropagation(); setNewFolderParent(""); setNewFolderName(""); }} style={{ fontSize: 12, padding: "6px 12px" }}>
            + Folder
          </button>
          <button className="btn" onClick={async () => {
            await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: `Untitled-${files.length + 1}.md`, content: "# New Document\n\nStart writing...\n" }),
            });
            fetchFiles();
          }} style={{ fontSize: 12, padding: "6px 12px" }}>
            + File
          </button>
          <span style={{ color: "var(--text-muted)", fontSize: 13, marginLeft: 8 }}>{session?.user?.email}</span>
          <button className="btn-ghost btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => signOut()}>Sign out</button>
        </div>
      </div>

      {/* Drop overlay */}
      {dragging && (
        <div className="fm-drop-overlay">
          Drop .md files here to upload
        </div>
      )}

      {/* File tree */}
      <div className="fm-tree">
        {renderFolder(tree)}
        {files.filter((f) => !f.path.endsWith("/.folder")).length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
            No files yet. Create a file or drag & drop .md files here.
          </div>
        )}
      </div>
    </div>
  );
}
