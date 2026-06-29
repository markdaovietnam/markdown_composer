"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  selectedText: string;
  position: { x: number; y: number };
  onRewrite: (newText: string) => void;
  onClose: () => void;
}

export default function RewriteDialog({ selectedText, position, onRewrite, onClose }: Props) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleRewrite = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedText, prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Request failed");
        return;
      }
      setResult(data.result);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const top = Math.min(position.y, window.innerHeight - 400);
  const left = Math.min(position.x, window.innerWidth - 380);

  return (
    <div className="rw-overlay">
      <div
        ref={dialogRef}
        className="rw-dialog"
        style={{ top: Math.max(8, top), left: Math.max(8, left) }}
      >
        <div className="rw-header">
          <span className="rw-title">✨ Rewrite with AI</span>
          <button className="rw-close" onClick={onClose}>✕</button>
        </div>

        <div className="rw-selected">
          <div className="rw-selected-label">Selected text</div>
          <div className="rw-selected-text">{selectedText.length > 200 ? selectedText.slice(0, 200) + "..." : selectedText}</div>
        </div>

        {!result ? (
          <>
            <textarea
              ref={inputRef}
              className="rw-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Make it more professional, Translate to English, Shorten this..."
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRewrite(); }
                if (e.key === "Escape") onClose();
              }}
            />
            {error && <div className="rw-error">{error}</div>}
            <div className="rw-actions">
              <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
              <button className="btn" onClick={handleRewrite} disabled={loading || !prompt.trim()} style={{ fontSize: 12 }}>
                {loading ? "Rewriting..." : "Rewrite"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rw-result">
              <div className="rw-selected-label">Result</div>
              <div className="rw-result-text">{result}</div>
            </div>
            <div className="rw-actions">
              <button className="btn-ghost btn" onClick={() => setResult(null)} style={{ fontSize: 12 }}>Try again</button>
              <button className="btn-ghost btn" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
              <button className="btn" onClick={() => { onRewrite(result); onClose(); }} style={{ fontSize: 12 }}>
                Accept & Replace
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
