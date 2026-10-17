'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const {
  stripCommentsAndStrings,
  extractEntryClass,
  getCommands,
  xmxForLimit,
  JavaExtractionError,
} = require('../../src/judge/languages/java');

const clean = (s) => stripCommentsAndStrings(s);

test('public class is the entry class', () => {
  assert.equal(extractEntryClass(clean('public class Solution { public static void main(String[] a){} }')), 'Solution');
});

test('package-private class with main is the fallback entry class', () => {
  const src = `
    class Helper {}
    class MyProgram { public static void main(String[] args) {} }
  `;
  assert.equal(extractEntryClass(clean(src)), 'MyProgram');
});

test('text blocks are blanked before the string-literal pass (no residual quotes)', () => {
  const src = `
    public class TextBlockDemo {
      public static void main(String[] a) {
        String s = """
          public class Fake { public static void main(String[] x){} }
        """;
      }
    }
  `;
  assert.equal(extractEntryClass(clean(src)), 'TextBlockDemo');
});

test('no main method → JavaExtractionError', () => {
  assert.throws(() => extractEntryClass(clean('class A {} class B {}')), JavaExtractionError);
});

test('getCommands compiles and runs the detected class with sized heap + GC flags', () => {
  const src = 'public class Sol { public static void main(String[] a){} }';
  const { compileCmd, runCmd, className } = getCommands(src, { memoryLimitMB: 256 });
  assert.equal(className, 'Sol');
  assert.match(compileCmd, /javac .*Sol\.java/);
  assert.match(runCmd, /java .*-cp .* Sol$/);
  assert.match(runCmd, /-XX:\+UseContainerSupport/);
  assert.match(runCmd, /-Xmx208m/);          // 256 - 48
});

test('xmxForLimit sizes the heap under the limit, floored at 16m', () => {
  assert.equal(xmxForLimit(256), 208);
  assert.equal(xmxForLimit(64), 16);
  assert.equal(xmxForLimit(undefined), 208);
});
