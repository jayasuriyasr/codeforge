'use strict';

// ── JavaScript (Node.js) language handler ────────────────────────────────────
// No compile step — JS is interpreted by Node.js inside the container.
// Run: node /workspace/solution.js
//
// compileCmd is null. The Runner checks for null and skips the compile phase.

const WORKSPACE = '/workspace';

/**
 * Returns the command strings for a JavaScript submission.
 * compileCmd is null — there is no compilation step.
 *
 * @returns {{ compileCmd: null, runCmd: string }}
 */
function getCommands() {
  const sourceFile = `${WORKSPACE}/solution.js`;

  return {
    compileCmd: null,                      // no compile step
    runCmd:     `node ${sourceFile}`,
  };
}

/** Filename to write the source into inside /workspace */
function sourceFileName() {
  return 'solution.js';
}

module.exports = { getCommands, sourceFileName, WORKSPACE };
