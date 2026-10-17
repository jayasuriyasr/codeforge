'use strict';

// ── Acceptance test — Java handler (§5 arch doc) ──────────────────────────────
// Three acceptance criteria from the step spec:
//  (a) normal `public class Solution`
//  (b) package-private class (no public) with static void main
//  (c) source containing a Java text block — must not break string stripping

const {
  stripCommentsAndStrings,
  extractEntryClass,
  getCommands,
  JavaExtractionError,
  JVM_FLAGS,
  WORKSPACE,
} = require('./src/judge/languages/java');

let passed = 0, failed = 0;

function assert(label, fn) {
  try   { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.message}`); failed++; }
}
function assertThrows(label, fn, msgFragment) {
  try {
    fn();
    console.error(`  ❌  ${label} — expected throw, got nothing`);
    failed++;
  } catch (e) {
    if (msgFragment && !e.message.includes(msgFragment)) {
      console.error(`  ❌  ${label} — wrong error: "${e.message}"`);
      failed++;
    } else {
      console.log(`  ✅  ${label}`);
      passed++;
    }
  }
}

// ── (a) Normal public class ───────────────────────────────────────────────────
console.log('\n── (a) Normal public class Solution ────────────────────────────');
{
  const src = `
public class Solution {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}`;

  assert('extractEntryClass returns "Solution"', () => {
    const clean = stripCommentsAndStrings(src);
    const name  = extractEntryClass(clean);
    if (name !== 'Solution') throw new Error(`Got "${name}"`);
  });

  assert('getCommands className = Solution', () => {
    const { className } = getCommands(src);
    if (className !== 'Solution') throw new Error(`Got "${className}"`);
  });

  assert('compileCmd contains javac and Solution.java', () => {
    const { compileCmd } = getCommands(src);
    if (!compileCmd.includes('javac'))            throw new Error(`Got: ${compileCmd}`);
    if (!compileCmd.includes('Solution.java'))    throw new Error(`Got: ${compileCmd}`);
    if (!compileCmd.includes(WORKSPACE))          throw new Error(`Got: ${compileCmd}`);
  });

  assert('runCmd contains java and Solution and all JVM flags', () => {
    const { runCmd } = getCommands(src);
    if (!runCmd.includes('java '))                     throw new Error(`Got: ${runCmd}`);
    if (!runCmd.includes('Solution'))                  throw new Error(`Got: ${runCmd}`);
    if (!runCmd.includes('-Xmx96m'))                   throw new Error(`Missing -Xmx96m`);
    if (!runCmd.includes('-XX:MaxMetaspaceSize=48m'))  throw new Error(`Missing -XX:MaxMetaspaceSize=48m`);
    if (!runCmd.includes('-XX:+UseSerialGC'))           throw new Error(`Missing -XX:+UseSerialGC`);
    if (!runCmd.includes('-XX:+UseContainerSupport'))  throw new Error(`Missing -XX:+UseContainerSupport`);
  });
}

// ── (b) Package-private class (no public modifier) ────────────────────────────
console.log('\n── (b) Package-private class with static void main ─────────────');
{
  const src = `
class Helper {
    static int add(int a, int b) { return a + b; }
}

class MyProgram {
    public static void main(String[] args) {
        System.out.println(Helper.add(1, 2));
    }
}`;

  assert('extractEntryClass returns "MyProgram" (the class with main)', () => {
    const clean = stripCommentsAndStrings(src);
    const name  = extractEntryClass(clean);
    if (name !== 'MyProgram') throw new Error(`Got "${name}"`);
  });

  assert('getCommands className = MyProgram', () => {
    const { className } = getCommands(src);
    if (className !== 'MyProgram') throw new Error(`Got "${className}"`);
  });

  assert('compileCmd targets MyProgram.java', () => {
    const { compileCmd } = getCommands(src);
    if (!compileCmd.includes('MyProgram.java')) throw new Error(`Got: ${compileCmd}`);
  });
}

// ── (c) Java text block must not break string stripping ───────────────────────
console.log('\n── (c) Text block (Java 15+) handling ──────────────────────────');
{
  // Text block contains embedded double-quotes — this is what breaks the v2 tokenizer
  // if text blocks aren't blanked first.
  const src = `
public class TextBlockDemo {
    public static void main(String[] args) {
        String json = """
                {
                    "name": "Alice",
                    "age": 30
                }
                """;
        System.out.println(json);
    }
}`;

  assert('stripCommentsAndStrings blanks the text block without residual quotes', () => {
    const clean = stripCommentsAndStrings(src);
    // After stripping, the text block should be replaced with "" and no stray quotes inside
    // The class structure should still be parseable
    if (clean.includes('Alice'))  throw new Error('Text block content leaked through');
    if (clean.includes('name":')) throw new Error('Text block not fully stripped');
  });

  assert('extractEntryClass still returns "TextBlockDemo" after text-block source', () => {
    const clean = stripCommentsAndStrings(src);
    const name  = extractEntryClass(clean);
    if (name !== 'TextBlockDemo') throw new Error(`Got "${name}"`);
  });

  assert('getCommands succeeds on text-block source', () => {
    const { className, compileCmd, runCmd } = getCommands(src);
    if (className !== 'TextBlockDemo') throw new Error(`className: "${className}"`);
    if (!compileCmd.includes('TextBlockDemo.java')) throw new Error(`compileCmd: ${compileCmd}`);
    if (!runCmd.includes('TextBlockDemo'))           throw new Error(`runCmd: ${runCmd}`);
  });
}

// ── Text block ordering: text-first vs string-first regression ────────────────
console.log('\n── Text-block ordering regression ───────────────────────────────');
{
  // If the ordinary string regex ran first, the triple-quote delimiters would be
  // consumed as an empty string "" followed by a stray ", breaking everything after.
  const srcWithTextBlock = `class X { public static void main(String[] a) {
    String s = """hello "world" """; System.out.println(s); } }`;

  assert('stripCommentsAndStrings handles text block with embedded quotes', () => {
    // Should not throw; the extracted clean source should still contain "class X"
    const clean = stripCommentsAndStrings(srcWithTextBlock);
    if (!clean.includes('class X')) throw new Error('class X disappeared from clean source');
    if (clean.includes('hello'))    throw new Error('Text block content not stripped');
  });

  assert('extractEntryClass finds X from text-block source', () => {
    const clean = stripCommentsAndStrings(srcWithTextBlock);
    const name  = extractEntryClass(clean);
    if (name !== 'X') throw new Error(`Got "${name}"`);
  });
}

// ── Error cases ───────────────────────────────────────────────────────────────
console.log('\n── Error cases ──────────────────────────────────────────────────');
{
  assertThrows(
    'no main method throws JavaExtractionError',
    () => extractEntryClass('class Foo { void helper() {} }'),
    'no class with a main method found'
  );

  assertThrows(
    'empty source throws JavaExtractionError',
    () => extractEntryClass(''),
    'no class with a main method found'
  );
}

// ── JVM flags verbatim ────────────────────────────────────────────────────────
console.log('\n── JVM flags (verbatim from §5) ─────────────────────────────────');
{
  assert('JVM_FLAGS contains -Xmx96m',                  () => { if (!JVM_FLAGS.includes('-Xmx96m')) throw new Error(JVM_FLAGS); });
  assert('JVM_FLAGS contains -XX:MaxMetaspaceSize=48m', () => { if (!JVM_FLAGS.includes('-XX:MaxMetaspaceSize=48m')) throw new Error(JVM_FLAGS); });
  assert('JVM_FLAGS contains -XX:+UseSerialGC',          () => { if (!JVM_FLAGS.includes('-XX:+UseSerialGC')) throw new Error(JVM_FLAGS); });
  assert('JVM_FLAGS contains -XX:+UseContainerSupport', () => { if (!JVM_FLAGS.includes('-XX:+UseContainerSupport')) throw new Error(JVM_FLAGS); });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
if (failed > 0) process.exit(1);
