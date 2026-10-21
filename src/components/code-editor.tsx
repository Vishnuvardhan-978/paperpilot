"use client";

import { DiffEditor, Editor, loader, type BeforeMount, type DiffOnMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";

// Served from public/monaco (copied by scripts/copy-monaco.mjs) so no internet is needed.
loader.config({ paths: { vs: "/monaco/vs" } });

const THEME = "paperpilot-dark";

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  md: "markdown",
  py: "python",
  java: "java",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  c: "c",
  h: "cpp",
  go: "go",
  rs: "rust",
  php: "php",
  rb: "ruby",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  ps1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  kt: "kotlin",
  swift: "swift",
  dart: "dart",
  vue: "html",
  svelte: "html",
};

export function languageForPath(path: string | null | undefined) {
  const ext = (path || "").split(".").pop()?.toLowerCase() || "";
  return LANG_BY_EXT[ext] || "plaintext";
}

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0b1127",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#3a4d66",
      "editorLineNumber.activeForeground": "#8ca3be",
      "editorGutter.background": "#0b1127",
      "diffEditor.insertedTextBackground": "#2ea04333",
      "diffEditor.removedTextBackground": "#f8514933",
      "diffEditor.insertedLineBackground": "#2ea0431f",
      "diffEditor.removedLineBackground": "#f851491f",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
    },
  });
};

const BASE_OPTIONS = {
  fontSize: 12.5,
  fontFamily: "Consolas, 'Cascadia Code', 'JetBrains Mono', monospace",
  minimap: { enabled: true, scale: 1 },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  automaticLayout: true,
  renderWhitespace: "selection" as const,
  tabSize: 2,
  padding: { top: 8 },
};

function Loading() {
  return <div className="p-3 font-mono text-[11px] text-[#415570]">Loading editor…</div>;
}

type EditorInstance = Parameters<OnMount>[0];

export function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
  revealLine = null,
}: {
  path: string;
  value: string;
  onChange?: (next: string) => void;
  onSave?: (text: string) => void;
  readOnly?: boolean;
  /** Scroll to and select this line; change `nonce` to jump again to the same line. */
  revealLine?: { line: number; nonce: number } | null;
}) {
  const saveRef = useRef(onSave);
  const editorRef = useRef<EditorInstance | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealLine || !mounted) return;
    const line = Math.max(1, revealLine.line);
    editor.revealLineInCenter(line);
    editor.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: Number.MAX_SAFE_INTEGER });
    editor.focus();
  }, [revealLine, mounted]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    setMounted(true);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current?.(editor.getValue());
    });
  };

  return (
    <Editor
      path={path}
      value={value}
      language={languageForPath(path)}
      theme={THEME}
      beforeMount={defineTheme}
      onMount={onMount}
      onChange={(v) => onChange?.(v ?? "")}
      loading={<Loading />}
      options={{ ...BASE_OPTIONS, readOnly }}
    />
  );
}

export function CodeDiff({
  path,
  original,
  modified,
}: {
  path: string;
  original: string;
  modified: string;
}) {
  const diffRef = useRef<Parameters<DiffOnMount>[0] | null>(null);

  // The wrapper disposes the models before resetting the widget, which throws; detach first, then dispose.
  useEffect(
    () => () => {
      const editor = diffRef.current;
      if (!editor) return;
      const models = editor.getModel();
      editor.setModel(null);
      models?.original.dispose();
      models?.modified.dispose();
    },
    [],
  );

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={languageForPath(path)}
      theme={THEME}
      beforeMount={defineTheme}
      onMount={(editor) => {
        diffRef.current = editor;
      }}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      loading={<Loading />}
      options={{
        ...BASE_OPTIONS,
        readOnly: true,
        renderSideBySide: false,
        originalEditable: false,
        minimap: { enabled: false },
      }}
    />
  );
}
