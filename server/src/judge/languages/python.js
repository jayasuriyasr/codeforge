'use strict';

// ── Python language handler ────────────────────────────────────────────────────
// No compile step — Python is interpreted.
// Run: python3 /workspace/solution.py
//
// compileCmd is null. The Runner checks for null and skips the compile phase.

const WORKSPACE = '/workspace';

/**
 * Returns the command strings for a Python submission.
 * compileCmd is null — there is no compilation step for Python.
 *
 * @returns {{ compileCmd: null, runCmd: string }}
 */
function getCommands() {
  const sourceFile = `${WORKSPACE}/solution.py`;

  return {
    compileCmd: null,                        // no compile step
    runCmd:     `python3 ${sourceFile}`,
  };
}

/** Filename to write the source into inside /workspace */
function sourceFileName() {
  return 'solution.py';
}

module.exports = { getCommands, sourceFileName, WORKSPACE };
