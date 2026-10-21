/**
 * Deterministic comment removal, so the agent never has to hand-edit or script it.
 * C-style code is scanned with string / template / regex awareness; HTML, JSP and XML
 * lose markup comments, and their <script>, <style> and <% %> blocks are scanned as code.
 */

type CodeOpts = { regex: boolean; template: boolean; lineComments: boolean; cssUrl: boolean };

const JS: CodeOpts = { regex: true, template: true, lineComments: true, cssUrl: false };
const C_LIKE: CodeOpts = { regex: false, template: false, lineComments: true, cssUrl: false };
const CSS: CodeOpts = { regex: false, template: false, lineComments: false, cssUrl: true };
const SCSS: CodeOpts = { regex: false, template: false, lineComments: true, cssUrl: true };

type Mode = { kind: "code"; opts: CodeOpts } | { kind: "markup"; jsp: boolean };

const MODES: Record<string, Mode> = {};
for (const ext of ["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"]) MODES[ext] = { kind: "code", opts: JS };
for (const ext of ["java", "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "kt", "kts", "swift", "scala", "dart", "groovy", "gradle"]) {
  MODES[ext] = { kind: "code", opts: C_LIKE };
}
MODES.css = { kind: "code", opts: CSS };
for (const ext of ["scss", "less"]) MODES[ext] = { kind: "code", opts: SCSS };
for (const ext of ["html", "htm", "xhtml", "xml", "vue", "svelte"]) MODES[ext] = { kind: "markup", jsp: false };
for (const ext of ["jsp", "jspf", "jspx", "tag"]) MODES[ext] = { kind: "markup", jsp: true };

export function commentSyntaxFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return MODES[ext] ? ext : null;
}

/** Marks where a comment was; lines left holding only marks are dropped at the end. */
const MARK = "\u0000";
/** Stands in for a protected JSP block inside <script>/<style> while that code is scanned. */
const HOLD = "\u0001";

const REGEX_PREV = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_KEYWORDS = new Set(["return", "case", "throw", "delete", "typeof", "void", "instanceof", "in", "of", "do", "else", "new", "yield", "await"]);

function lineIndent(src: string, at: number) {
  const start = src.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(src.slice(start, at))?.[0] ?? "";
}

/** Replacement for a removed comment: multi-line comments keep one line break (needed for ASI). */
function removedText(src: string, from: number, to: number) {
  if (!/[\r\n]/.test(src.slice(from, to))) return MARK;
  return `${MARK}\n${lineIndent(src, from)}${MARK}`;
}

function skipInlineSpace(src: string, i: number) {
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  return i;
}

function stripCode(src: string, opts: CodeOpts) {
  let out = "";
  let removed = 0;
  let i = 0;
  const n = src.length;

  const prevSignificant = () => {
    let j = out.length - 1;
    while (j >= 0 && (out[j] === MARK || /\s/.test(out[j]))) j--;
    if (j < 0) return { ch: "", word: "" };
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--;
    return { ch: out[j], word: out.slice(k + 1, j + 1) };
  };

  const regexAllowed = () => {
    const { ch, word } = prevSignificant();
    if (!ch) return true;
    if (word) return REGEX_KEYWORDS.has(word);
    return REGEX_PREV.has(ch);
  };

  const scanQuoted = (quote: string) => {
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === quote) {
        j++;
        break;
      } else if (c === "\n") break;
      else j++;
    }
    out += src.slice(i, j);
    i = j;
  };

  /** Returns false if this "/" is not a complete regex literal (then it's division). */
  const scanRegex = () => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "\n" || c === "\r") return false;
      else if (c === "[" || c === "]") {
        inClass = c === "[";
        j++;
      } else if (c === "/" && !inClass) {
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        out += src.slice(i, j);
        i = j;
        return true;
      } else j++;
    }
    return false;
  };

  const scanTemplate = () => {
    out += "`";
    i++;
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        out += "`";
        i++;
        return;
      } else if (c === "$" && src[i + 1] === "{") {
        out += "${";
        i += 2;
        scan(true);
      } else {
        out += c;
        i++;
      }
    }
  };

  function scan(untilBrace: boolean) {
    let depth = 0;
    while (i < n) {
      const ch = src[i];
      const next = src[i + 1];
      if (ch === "/" && next === "/" && opts.lineComments) {
        let j = i + 2;
        while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
        out += MARK;
        removed++;
        i = j;
      } else if (ch === "/" && next === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        const multi = /[\r\n]/.test(src.slice(i, stop));
        out += removedText(src, i, stop);
        removed++;
        i = multi ? skipInlineSpace(src, stop) : stop;
      } else if (ch === '"' || ch === "'") {
        scanQuoted(ch);
      } else if (ch === "`" && opts.template) {
        scanTemplate();
      } else if (ch === "/" && opts.regex && regexAllowed() && scanRegex()) {
        /* regex literal copied */
      } else if (opts.cssUrl && /^url\(/i.test(src.slice(i, i + 4))) {
        const end = src.indexOf(")", i);
        const stop = end < 0 ? n : end + 1;
        out += src.slice(i, stop);
        i = stop;
      } else {
        if (untilBrace) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            if (depth === 0) {
              out += "}";
              i++;
              return;
            }
            depth--;
          }
        }
        out += ch;
        i++;
      }
    }
  }

  scan(false);
  return { out, removed };
}

const SCRIPT_TYPES = /^(|text\/javascript|application\/javascript|module|text\/babel|text\/jsx|application\/ecmascript|text\/ecmascript)$/i;

function stripMarkup(src: string, jsp: boolean) {
  let out = "";
  let removed = 0;
  let i = 0;
  const n = src.length;
  const lower = src.toLowerCase();

  const dropComment = (start: number, close: string) => {
    const end = src.indexOf(close, start);
    const stop = end < 0 ? n : end + close.length;
    const multi = /[\r\n]/.test(src.slice(i, stop));
    out += removedText(src, i, stop);
    removed++;
    i = multi ? skipInlineSpace(src, stop) : stop;
  };

  /** JSP blocks inside script/style are held out of the code scan, then restored with their own comments stripped. */
  const stripEmbedded = (code: string, opts: CodeOpts) => {
    const held: string[] = [];
    let text = code;
    if (jsp) {
      text = text.replace(/<%--[\s\S]*?--%>/g, () => {
        removed++;
        return MARK;
      });
      text = text.replace(/<%[\s\S]*?%>/g, (block) => {
        held.push(stripJspBlock(block));
        return `${HOLD}${held.length - 1}${HOLD}`;
      });
    }
    const r = stripCode(text, opts);
    removed += r.removed;
    return r.out.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (_, k: string) => held[Number(k)]);
  };

  const stripJspBlock = (block: string) => {
    if (block.startsWith("<%@") || !block.endsWith("%>")) return block;
    const head = /^<%[=!]?/.exec(block)![0];
    const r = stripCode(block.slice(head.length, -2), C_LIKE);
    removed += r.removed;
    return `${head}${r.out}%>`;
  };

  const embedded = (tag: "script" | "style") => {
    const openEnd = src.indexOf(">", i);
    if (openEnd < 0) return false;
    const close = lower.indexOf(`</${tag}`, openEnd);
    const stop = close < 0 ? n : close;
    const openTag = src.slice(i, openEnd + 1);
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(openTag)?.[1] ?? "";
    out += openTag;
    const inner = src.slice(openEnd + 1, stop);
    if (tag === "script" && !SCRIPT_TYPES.test(type)) out += inner;
    else out += stripEmbedded(inner, tag === "script" ? JS : CSS);
    i = stop;
    return true;
  };

  while (i < n) {
    if (jsp && src.startsWith("<%--", i)) {
      dropComment(i + 4, "--%>");
    } else if (src.startsWith("<!--", i)) {
      if (/^<!--\s*\[if/i.test(src.slice(i, i + 12))) {
        const end = lower.indexOf("<![endif]-->", i);
        const stop = end < 0 ? n : end + 12;
        out += src.slice(i, stop);
        i = stop;
      } else {
        dropComment(i + 4, "-->");
      }
    } else if (jsp && src.startsWith("<%", i)) {
      const end = src.indexOf("%>", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += stripJspBlock(src.slice(i, stop));
      i = stop;
    } else if (lower.startsWith("<script", i) && /[\s>]/.test(src[i + 7] || "") && embedded("script")) {
      /* handled */
    } else if (lower.startsWith("<style", i) && /[\s>]/.test(src[i + 6] || "") && embedded("style")) {
      /* handled */
    } else {
      out += src[i];
      i++;
    }
  }
  return { out, removed };
}

/** Drops lines that held only comments and collapses blank lines left behind by them. */
function finalize(text: string, original: string) {
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  const kept: string[] = [];
  let dropped = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(MARK)) {
      if (!line.trim() && dropped && kept.length && !kept[kept.length - 1].trim()) continue;
      kept.push(line);
      if (line.trim()) dropped = false;
      continue;
    }
    if (!line.split(MARK).join("").trim()) {
      dropped = true;
      continue;
    }
    // A removed comment acts as whitespace: keep the indent, leave one space between tokens.
    const clean = line
      .replace(new RegExp(`^([ \\t]*)(?:${MARK}[ \\t]*)+`), "$1")
      .replace(new RegExp(`[ \\t]*(?:${MARK}[ \\t]*)+`, "g"), " ")
      .replace(/[ \t]+$/, "");
    kept.push(clean);
    dropped = false;
  }
  return kept.join(nl);
}

export type StripResult = { text: string; removed: number };

export function stripComments(path: string, source: string): StripResult {
  const ext = commentSyntaxFor(path);
  if (!ext) throw new Error(`remove_comments does not support .${path.split(".").pop()} files — use edit_file instead.`);
  const mode = MODES[ext];
  const r = mode.kind === "code" ? stripCode(source, mode.opts) : stripMarkup(source, mode.jsp);
  if (!r.removed) return { text: source, removed: 0 };
  return { text: finalize(r.out, source), removed: r.removed };
}
