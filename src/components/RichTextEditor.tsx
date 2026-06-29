"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useCallback } from "react";
import TurndownService from "turndown";
import { marked } from "marked";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  bulletListMarker: "-",
});

turndown.addRule("taskList", {
  filter: (node) => node.nodeName === "LI" && node.parentElement?.getAttribute("data-type") === "taskList",
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
    return `- [${checked ? "x" : " "}] ${content.trim()}\n`;
  },
});

turndown.addRule("highlight", {
  filter: "mark",
  replacement: (content) => `==${content}==`,
});

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).replace(/\n{3,}/g, "\n\n");
}

async function markdownToHtml(md: string): Promise<string> {
  return await marked.parse(md, { gfm: true, breaks: false });
}

interface Props {
  content: string;
  onChange: (markdown: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export default function RichTextEditor({ content, onChange, onContextMenu }: Props) {
  const suppressUpdate = useRef(false);
  const lastMarkdown = useRef("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: "rte-code-block" } },
      }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "rte-link" } }),
      Placeholder.configure({ placeholder: "Start writing..." }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Image.configure({ inline: true }),
    ],
    editorProps: {
      attributes: { class: "rte-editor" },
    },
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current) return;
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      lastMarkdown.current = md;
      onChange(md);
    },
  });

  const setContent = useCallback(async (md: string) => {
    if (!editor || md === lastMarkdown.current) return;
    lastMarkdown.current = md;
    suppressUpdate.current = true;
    const html = await markdownToHtml(md);
    editor.commands.setContent(html, { emitUpdate: false });
    suppressUpdate.current = false;
  }, [editor]);

  useEffect(() => {
    setContent(content);
  }, [content, setContent]);

  if (!editor) return null;

  return (
    <div className="rte-container" onContextMenu={onContextMenu}>
      {/* Toolbar */}
      <div className="rte-toolbar">
        <div className="rte-toolbar-group">
          <button
            className={`rte-tb-btn ${editor.isActive("heading", { level: 1 }) ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="Heading 1"
          >H1</button>
          <button
            className={`rte-tb-btn ${editor.isActive("heading", { level: 2 }) ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          >H2</button>
          <button
            className={`rte-tb-btn ${editor.isActive("heading", { level: 3 }) ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
          >H3</button>
        </div>

        <div className="rte-toolbar-sep" />

        <div className="rte-toolbar-group">
          <button
            className={`rte-tb-btn ${editor.isActive("bold") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("italic") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("strike") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("code") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline code"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("highlight") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
            title="Highlight"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11 7h6l-7 10V7z" opacity="0.6"/><path d="M18 3H6v18h12V3zm-2 4H8v2h8V7zm0 4H8v2h8v-2zm-4 4H8v2h4v-2z"/></svg>
          </button>
        </div>

        <div className="rte-toolbar-sep" />

        <div className="rte-toolbar-group">
          <button
            className={`rte-tb-btn ${editor.isActive("bulletList") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("orderedList") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("taskList") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            title="Task list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM17.99 9l-1.41-1.42-6.59 6.59-2.58-2.57-1.42 1.41 4 3.99z"/></svg>
          </button>
        </div>

        <div className="rte-toolbar-sep" />

        <div className="rte-toolbar-group">
          <button
            className={`rte-tb-btn ${editor.isActive("blockquote") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
          </button>
          <button
            className={`rte-tb-btn ${editor.isActive("codeBlock") ? "active" : ""}`}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code block"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9.29 16.29L5.7 12.7a.996.996 0 010-1.41L9.29 7.7c.39-.39 1.02-.39 1.41 0 .39.39.39 1.02 0 1.41L7.83 12l2.88 2.88c.39.39.39 1.02 0 1.41-.39.39-1.03.39-1.42 0zm5.42 0c-.39-.39-.39-1.02 0-1.41L17.59 12l-2.88-2.88a.996.996 0 010-1.41c.39-.39 1.02-.39 1.41 0l3.59 3.59c.39.39.39 1.02 0 1.41l-3.59 3.59c-.39.38-1.02.38-1.41-.01z"/></svg>
          </button>
          <button
            className="rte-tb-btn"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal rule"
          >—</button>
        </div>

        <div className="rte-toolbar-sep" />

        <div className="rte-toolbar-group">
          <button className="rte-tb-btn" onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={!editor.can().undo()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
          </button>
          <button className="rte-tb-btn" onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={!editor.can().redo()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
          </button>
        </div>
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  );
}
