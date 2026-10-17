#!/usr/bin/env node
// scripts/build-problems.mjs
// content/problems/*.json  ->  public/problems/{index.json, <slug>.json}
//
//   node scripts/build-problems.mjs
//
// Runs automatically before `vite build` and `vite dev` (see package.json).

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'content', 'problems');
const OUT = join(ROOT, 'public', 'problems');

const MAX_TIME_SEC = 10;
const MAX_MEM_MB = 512;
const MAX_CASES = 60;
const LANGS = ['c', 'cpp', 'java', 'python', 'javascript'];
const CHECKERS = ['exact', 'float'];

function fail(msg) { console.error(`\x1b[31m[problems] ${msg}\x1b[0m`); process.exitCode = 1; }

function validate(p, file) {
  const errs = [];
  const need = (k, t) => { if (typeof p[k] !== t) errs.push(`${k} must be ${t}`); };
  need('slug', 'string'); need('title', 'string'); need('statement', 'string');
  need('difficulty', 'string'); need('timeLimitSec', 'number'); need('memoryLimitMB', 'number');

  if (p.slug && basename(file, '.json') !== p.slug) errs.push(`filename must be "${p.slug}.json"`);
  if (p.slug && !/^[a-z0-9-]+$/.test(p.slug)) errs.push('slug must be kebab-case [a-z0-9-]');
  if (!['easy', 'medium', 'hard'].includes(p.difficulty)) errs.push('difficulty: easy|medium|hard');
  if (p.timeLimitSec > MAX_TIME_SEC || p.timeLimitSec < 0.5) errs.push(`timeLimitSec 0.5..${MAX_TIME_SEC}`);
  if (p.memoryLimitMB > MAX_MEM_MB || p.memoryLimitMB < 16) errs.push(`memoryLimitMB 16..${MAX_MEM_MB}`);
  if (p.checkerType && !CHECKERS.includes(p.checkerType)) errs.push(`checkerType: ${CHECKERS.join('|')}`);

  const cases = p.testCases;
  if (!Array.isArray(cases) || cases.length === 0) errs.push('testCases must be a non-empty array');
  else {
    if (cases.length > MAX_CASES) errs.push(`at most ${MAX_CASES} test cases`);
    cases.forEach((c, i) => {
      if (typeof c.input !== 'string') errs.push(`testCases[${i}].input must be a string`);
      if (typeof c.expectedOutput !== 'string') errs.push(`testCases[${i}].expectedOutput must be a string`);
    });
    if (!cases.some((c) => c.sample)) errs.push('at least one test case must be "sample": true');
  }
  return errs;
}

function main() {
  if (!existsSync(SRC)) { fail(`no ${SRC}`); return; }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const files = readdirSync(SRC).filter((f) => f.endsWith('.json'));
  const index = [];
  const seen = new Set();

  for (const file of files) {
    let p;
    try { p = JSON.parse(readFileSync(join(SRC, file), 'utf8')); }
    catch (e) { fail(`${file}: invalid JSON — ${e.message}`); continue; }

    const errs = validate(p, file);
    if (errs.length) { fail(`${file}:\n  - ${errs.join('\n  - ')}`); continue; }
    if (seen.has(p.slug)) { fail(`${file}: duplicate slug "${p.slug}"`); continue; }
    seen.add(p.slug);

    const full = {
      slug: p.slug,
      title: p.title,
      difficulty: p.difficulty,
      tags: Array.isArray(p.tags) ? p.tags : [],
      statement: p.statement,
      timeLimitSec: p.timeLimitSec,
      memoryLimitMB: p.memoryLimitMB,
      checkerType: p.checkerType || 'exact',
      languages: Array.isArray(p.languages) ? p.languages.filter((l) => LANGS.includes(l)) : LANGS,
      testCases: p.testCases.map((c) => ({
        input: c.input,
        expectedOutput: c.expectedOutput,
        sample: !!c.sample,
        label: c.label || undefined,
      })),
    };
    writeFileSync(join(OUT, `${p.slug}.json`), JSON.stringify(full));

    index.push({
      slug: full.slug,
      title: full.title,
      difficulty: full.difficulty,
      tags: full.tags,
      timeLimitSec: full.timeLimitSec,
      memoryLimitMB: full.memoryLimitMB,
      checkerType: full.checkerType,
      caseCount: full.testCases.length,
      sampleCount: full.testCases.filter((c) => c.sample).length,
    });
  }

  index.sort((a, b) => ({ easy: 0, medium: 1, hard: 2 }[a.difficulty] - { easy: 0, medium: 1, hard: 2 }[b.difficulty]) || a.title.localeCompare(b.title));
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));

  if (process.exitCode) console.error(`\x1b[31m[problems] build FAILED\x1b[0m`);
  else console.log(`[problems] ${index.length} problem(s) -> public/problems/`);
}

main();
