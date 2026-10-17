'use strict';

// ── C / C++ language handler ──────────────────────────────────────────────────
// Compile: gcc (C) or g++ (C++) → /workspace/a.out
// Run:     /workspace/a.out  (inside the container, as uid 1000)
//
// File is written to /workspace/solution.c or /workspace/solution.cpp
// by the Runner before invoking compileCmd.

const WORKSPACE = '/workspace';

/**
 * Returns the compile + run command strings for a C or C++ submission.
 *
 * @param {'c'|'cpp'} language
 * @returns {{ compileCmd: string, runCmd: string }}
 */
function getCommands(language) {
  if (language !== 'c' && language !== 'cpp') {
    throw new Error(`cpp handler does not support language "${language}"`);
  }

  const compiler   = language === 'c' ? 'gcc' : 'g++';
  const sourceFile = language === 'c'
    ? `${WORKSPACE}/solution.c`
    : `${WORKSPACE}/solution.cpp`;
  const binary     = `${WORKSPACE}/a.out`;

  // -O2: standard competitive-programming optimisation level
  // -o: explicit output path inside /workspace (the only writable dir)
  // -lm: link math library (needed by many C submissions)
  // -std=c++17: modern standard for C++
  const compileCmd = language === 'c'
    ? `${compiler} -O2 -o ${binary} ${sourceFile} -lm`
    : `${compiler} -O2 -std=c++17 -o ${binary} ${sourceFile} -lm`;

  const runCmd = binary;

  return { compileCmd, runCmd };
}

/** Filename to write the source into inside /workspace */
function sourceFileName(language) {
  return language === 'c' ? 'solution.c' : 'solution.cpp';
}

module.exports = { getCommands, sourceFileName, WORKSPACE };
