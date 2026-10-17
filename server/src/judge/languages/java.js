'use strict';

// ── Java language handler ─────────────────────────────────────────────────────
// Compile: javac /workspace/Solution.java  (class name extracted at enqueue time)
// Run:     java  <JVM_FLAGS> -cp /workspace <ClassName>
//
// JVM flags — unchanged from v2, still correct (copy verbatim from §5):
//   -Xmx96m              heap ceiling (works correctly with cgroup accounting, unlike ulimit -v)
//   -XX:MaxMetaspaceSize=48m  cap metaspace
//   -XX:+UseSerialGC     minimal GC overhead, appropriate for short-lived judge runs
//   -XX:+UseContainerSupport  makes JVM read cgroup limits, not host RAM

const WORKSPACE    = '/workspace';

// Metaspace + GC/JIT/thread-stack overhead the JVM needs ON TOP of the heap.
// The supervisor grants Java this much extra headroom before calling MLE
// (a real solution is judged on heap, not on JVM bookkeeping).
const JVM_OVERHEAD_MB = 64;

// GC + container-awareness flags are always safe. `-Xmx` is sized per problem
// in getCommands().
const JVM_BASE_FLAGS = '-XX:+UseSerialGC -XX:+UseContainerSupport -XX:MaxMetaspaceSize=48m';

/** Heap ceiling for a problem: fits inside the limit with room for metaspace. */
function xmxForLimit(memoryLimitMB) {
  const mb = Number(memoryLimitMB) || 256;
  return Math.max(16, mb - 48);
}

// ── Custom error ──────────────────────────────────────────────────────────────
class JavaExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JavaExtractionError';
  }
}

// ── stripCommentsAndStrings ───────────────────────────────────────────────────
// ORDERING IS LOAD-BEARING — do not reorder these .replace() calls.
// Text blocks ("""...""", Java 15+) must be blanked BEFORE the ordinary
// string-literal regex runs, or the triple-quote delimiters confuse it and
// leave residual " characters that corrupt the subsequent class-name scan.
// (This was the exact v2 bug — absent handling of text blocks entirely.)
function stripCommentsAndStrings(src) {
  return src
    .replace(/"""[\s\S]*?"""/g, '""')        // text blocks — must run first
    .replace(/"(\\.|[^"\\])*"/g, '""')        // ordinary string literals
    .replace(/'(\\.|[^'\\])*'/g, "''")        // char literals (defensive)
    .replace(/\/\/.*$/gm, '')                  // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');         // block comments
}

// ── extractEntryClass ─────────────────────────────────────────────────────────
// IMPORTANT: this function is regex-based, not a real Java parser.
// It is a heuristic — good enough for MVP judge submissions where contestants
// submit single-file solutions, but it is NOT a Java grammar. It can be fooled
// by unusual but valid Java constructs. Document this rather than pretend otherwise.
//
// Two-pass strategy (from §5 of arch doc):
//   Pass 1: look for `public [final|abstract] class <Name>` — the common case.
//   Pass 2: if no public class, scan every class body for `static ... main(` — the
//           fallback for package-private entry classes (valid in javac/java).
function extractEntryClass(cleanSrc) {
  // Pass 1: public class (includes `public final class` and `public abstract class`)
  const pub = cleanSrc.match(/public\s+(?:final\s+|abstract\s+)?class\s+(\w+)/);
  if (pub) return pub[1];

  // Pass 2: no public class — scan every top-level class for one that contains
  // a `static ... main(` declaration.
  //
  // NOTE: This function is regex-based, not a real Java parser. It is a heuristic —
  // good enough for MVP single-file judge submissions but NOT a Java grammar.
  //
  // We extract each class's brace-balanced body (tracking depth) so that a later
  // class's methods cannot bleed into an earlier class's scan window.  A flat
  // 2000-char slice from the `class` keyword is insufficient when the first class is
  // short enough that the window reaches into the next class's body.
  for (const m of cleanSrc.matchAll(/\bclass\s+(\w+)[^{]*\{/g)) {
    const body = extractClassBody(cleanSrc, m.index + m[0].length - 1);
    if (/static[^;{}]*main\s*\(/.test(body)) return m[1];
  }

  throw new JavaExtractionError('no class with a main method found');
}

/**
 * Extract the brace-balanced body of a class starting at `openBraceIndex`.
 * Returns the substring from (but not including) the opening brace to the
 * matching closing brace, inclusive.
 * This is still a heuristic — it doesn't handle strings/comments (call on
 * already-stripped source only).
 */
function extractClassBody(src, openBraceIndex) {
  let depth = 0;
  let i = openBraceIndex;
  const start = i;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
    i++;
  }
  // Unbalanced source — return what we have
  return src.slice(start);
}

// ── getCommands ───────────────────────────────────────────────────────────────
/**
 * Produce compile + run commands for a Java submission.
 *
 * @param {string} sourceCode — the raw Java source (used to extract the class name)
 * @returns {{ compileCmd: string, runCmd: string, className: string }}
 * @throws {JavaExtractionError} if no entry class can be found
 */
function getCommands(sourceCode, { memoryLimitMB } = {}) {
  const cleanSrc  = stripCommentsAndStrings(sourceCode);
  const className = extractEntryClass(cleanSrc);

  const compileCmd = `javac -d ${WORKSPACE} ${WORKSPACE}/${className}.java`;
  const runCmd = `java -Xmx${xmxForLimit(memoryLimitMB)}m ${JVM_BASE_FLAGS} -cp ${WORKSPACE} ${className}`;

  return { compileCmd, runCmd, className };
}

/** Filename to write the source into inside /workspace */
function sourceFileName(sourceCode) {
  // javac requires the filename to match the public class name.
  // We call getCommands() just for the className side-effect.
  const { className } = getCommands(sourceCode);
  return `${className}.java`;
}

module.exports = {
  getCommands,
  sourceFileName,
  stripCommentsAndStrings,
  extractEntryClass,
  xmxForLimit,
  JavaExtractionError,
  WORKSPACE,
  JVM_OVERHEAD_MB,
  JVM_BASE_FLAGS,
};
