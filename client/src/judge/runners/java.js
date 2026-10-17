// judge/runners/java.js
// ── In-browser Java runner (CheerpJ 4 — a WebAssembly JVM) ─────────────────
//
//   toolchain : CheerpJ 4.3 loader from Leaning Technologies' CDN. The JRE +
//               javac (`/app/tools.jar`) stream in on first use (~20 MB), then
//               the service worker + IndexedDB hold them — offline afterwards.
//   compile   : `com.sun.tools.javac.Main.compile(argv, writer)` driven by a
//               tiny embedded helper (CFJudge) so diagnostics land in a file we
//               can read back headlessly — CheerpJ has no stdout/stderr API.
//   run       : the helper redirects System.in from a staged file and
//               System.out/err to files in the IndexedDB `/files/` mount, then
//               reflectively invokes the user's `main`. We read the files back
//               with `cjFileBlob`.
//
//   TLE : wall clock. CheerpJ can't be force-killed from JS, so a watchdog
//         thread inside the helper calls System.exit(124) at the limit; the JS
//         side also races a timeout and reports TLE either way.
//   MLE : best effort — an OutOfMemoryError on stderr → MLE. CheerpJ ignores
//         -Xmx, so there is no hard cap (Python remains the only exact one).
//
// LICENCE: CheerpJ is free for personal, open-source and *educational* use.
//   This project is a non-commercial college project with no fees — that fits.
//   A commercial deployment would need a licence from Leaning Technologies;
//   set TOOLCHAINS.java = null in loader.js to disable Java entirely.

const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';

export class JavaUnavailable extends Error {
  constructor(msg) { super(msg); this.name = 'ToolchainUnavailable'; this.toolchain = 'java'; }
}

// CFJudge{,$1,$2}.class — compiled from scripts/java-helper/CFJudge.java with
// `javac -source 8 -target 8` (Java 8 bytecode is what CheerpJ's tools.jar
// expects). If you edit the .java, recompile and paste the new base64 here.
const HELPER_CLASSES = {
  'CFJudge.class':
    'yv66vgAAADQApwoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWCAAIAQAHY29tcGlsZQoACgALBwAMDAANAA4BABBqYXZhL2xhbmcvU3RyaW5nAQAGZXF1YWxzAQAVKExqYXZhL2xhbmcvT2JqZWN0OylaBwAQAQATamF2YS9pby9QcmludFdyaXRlcgcAEgEAGmphdmEvaW8vT3V0cHV0U3RyZWFtV3JpdGVyBwAUAQAYamF2YS9pby9GaWxlT3V0cHV0U3RyZWFtCAAWAQANL2ZpbGVzL19fZGlhZwoAEwAYDAAFABkBABUoTGphdmEvbGFuZy9TdHJpbmc7KVYIABsBAAVVVEYtOAoAEQAdDAAFAB4BACsoTGphdmEvaW8vT3V0cHV0U3RyZWFtO0xqYXZhL2xhbmcvU3RyaW5nOylWCgAPACAMAAUAIQEAEyhMamF2YS9pby9Xcml0ZXI7KVYKACMAJAcAJQwAJgAnAQAQamF2YS9sYW5nL1N5c3RlbQEACWFycmF5Y29weQEAKihMamF2YS9sYW5nL09iamVjdDtJTGphdmEvbGFuZy9PYmplY3Q7SUkpVgoAKQAqBwArDAAIACwBABhjb20vc3VuL3Rvb2xzL2phdmFjL01haW4BACsoW0xqYXZhL2xhbmcvU3RyaW5nO0xqYXZhL2lvL1ByaW50V3JpdGVyOylJCgAPAC4MAC8ABgEABWZsdXNoCgAPADEMADIABgEABWNsb3NlCgAjADQMADUANgEABGV4aXQBAAQoSSlWBwA4AQAXamF2YS9pby9GaWxlSW5wdXRTdHJlYW0KADcAGAoAIwA7DAA8AD0BAAVzZXRJbgEAGChMamF2YS9pby9JbnB1dFN0cmVhbTspVgcAPwEAE2phdmEvaW8vUHJpbnRTdHJlYW0HAEEBABxqYXZhL2lvL0J1ZmZlcmVkT3V0cHV0U3RyZWFtCABDAQAML2ZpbGVzL19fb3V0AwABAAAKAEAARgwABQBHAQAaKExqYXZhL2lvL091dHB1dFN0cmVhbTtJKVYKAD4ASQwABQBKAQAsKExqYXZhL2lvL091dHB1dFN0cmVhbTtaTGphdmEvbGFuZy9TdHJpbmc7KVYIAEwBAAwvZmlsZXMvX19lcnIKACMATgwATwBQAQAGc2V0T3V0AQAYKExqYXZhL2lvL1ByaW50U3RyZWFtOylWCgAjAFIMAFMAUAEABnNldEVycgoAVQBWBwBXDABYAFkBABFqYXZhL2xhbmcvUnVudGltZQEACmdldFJ1bnRpbWUBABUoKUxqYXZhL2xhbmcvUnVudGltZTsHAFsBAAlDRkp1ZGdlJDEKAFoAXQwABQBeAQAtKExqYXZhL2lvL1ByaW50U3RyZWFtO0xqYXZhL2lvL1ByaW50U3RyZWFtOylWCgBVAGAMAGEAYgEAD2FkZFNodXRkb3duSG9vawEAFShMamF2YS9sYW5nL1RocmVhZDspVgUAAAAAAAAnEAoAZgBnBwBoDABpAGoBAA5qYXZhL2xhbmcvTG9uZwEACXBhcnNlTG9uZwEAFShMamF2YS9sYW5nL1N0cmluZzspSgcAbAEAE2phdmEvbGFuZy9FeGNlcHRpb24FAAAAAAAAAfQHAHABAAlDRkp1ZGdlJDIKAG8AcgwABQBzAQAuKEpMamF2YS9pby9QcmludFN0cmVhbTtMamF2YS9pby9QcmludFN0cmVhbTspVgoAdQB2BwB3DAB4AHkBABBqYXZhL2xhbmcvVGhyZWFkAQAJc2V0RGFlbW9uAQAEKFopVgoAdQB7DAB8AAYBAAVzdGFydAoAfgB/BwCADACBAIIBAA9qYXZhL2xhbmcvQ2xhc3MBAAdmb3JOYW1lAQAlKExqYXZhL2xhbmcvU3RyaW5nOylMamF2YS9sYW5nL0NsYXNzOwgAhAEABG1haW4HAIYBABNbTGphdmEvbGFuZy9TdHJpbmc7CgB+AIgMAIkAigEACWdldE1ldGhvZAEAQChMamF2YS9sYW5nL1N0cmluZztbTGphdmEvbGFuZy9DbGFzczspTGphdmEvbGFuZy9yZWZsZWN0L01ldGhvZDsKAIwAjQcAjgwAjwCQAQAYamF2YS9sYW5nL3JlZmxlY3QvTWV0aG9kAQAGaW52b2tlAQA5KExqYXZhL2xhbmcvT2JqZWN0O1tMamF2YS9sYW5nL09iamVjdDspTGphdmEvbGFuZy9PYmplY3Q7BwCSAQAramF2YS9sYW5nL3JlZmxlY3QvSW52b2NhdGlvblRhcmdldEV4Y2VwdGlvbgoAkQCUDACVAJYBAAhnZXRDYXVzZQEAFygpTGphdmEvbGFuZy9UaHJvd2FibGU7CgCYAJkHAJoMAJsAUAEAE2phdmEvbGFuZy9UaHJvd2FibGUBAA9wcmludFN0YWNrVHJhY2UKAD4ALgcAngEAB0NGSnVkZ2UBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQAWKFtMamF2YS9sYW5nL1N0cmluZzspVgEADVN0YWNrTWFwVGFibGUBAApFeGNlcHRpb25zAQAKU291cmNlRmlsZQEADENGSnVkZ2UuamF2YQEADElubmVyQ2xhc3NlcwAhAJ0AAgAAAAAAAgABAAUABgABAJ8AAAAdAAEAAQAAAAUqtwABsQAAAAEAoAAAAAYAAQAAAAQACQCEAKEAAgCfAAACUQAHAAsAAAE7Kr6eAEsqAzISB7YACZkAQLsAD1m7ABFZuwATWRIVtwAXEhq3ABy3AB9MKr4EZL0ACk0qBCwDLL64ACIsK7gAKD4rtgAtK7YAMB24ADMqBDJMuwA3WSoFMrcAObgAOrsAPlm7AEBZuwATWRJCtwAXEkS3AEUDEhq3AEhNuwA+WbsAE1kSS7cAFwQSGrcASE4suABNLbgAUbgAVLsAWlksLbcAXLYAXxQAYzcEKgYyuABlNwSnAAU6BhYEFABtYTcGuwBvWRYGLC23AHE6CBkIBLYAdBkItgB6AzYJK7gAfRKDBL0AflkDEoVTtgCHOgoZCgEEvQACWQMDvQAKU7YAi1enACw6ChkKtgCTxwAIGQqnAAgZCrYAky22AJcENgmnAA46ChkKLbYAlwQ2CSy2AJwttgCcFQm4ADOxAAMAqwCzALYAawDbAQEBBACRANsBAQEiAJgAAgCgAAAAhgAhAAAABgAQAAcAKgAJADIACgA7AAsAQQAMAEkADQBNABAAUQARAF4AEgB7ABQAjwAVAJcAFgCmABkAqwAaALgAGwDAABwAzQAjANMAJADYACUA2wAnAO8AKAEBAC8BBAApAQYAKgEcACsBHwAvASIALAEkAC0BKgAuAS0AMAE1ADEBOgAyAKIAAABgAAj7AE3/AGgABQcAhQcACgcAPgcAPgQAAQcAawH/AEsACAcAhQcACgcAPgcAPgQEBwB1AQABBwCR/AAOBwCRRAcAmP8ACQAIBwCFBwAKBwA+BwA+BAQHAHUBAAEHAJgKAKMAAAAEAAEAawACAKQAAAACAKUApgAAABIAAgBaAAAAAAAAAG8AAAAAAAA=',
  'CFJudge$1.class':
    'yv66vgAAADQAIgkAAgADBwAEDAAFAAYBAAlDRkp1ZGdlJDEBAAd2YWwkb3V0AQAVTGphdmEvaW8vUHJpbnRTdHJlYW07CQACAAgMAAkABgEAB3ZhbCRlcnIKAAsADAcADQwADgAPAQAQamF2YS9sYW5nL1RocmVhZAEABjxpbml0PgEAAygpVgoAEQASBwATDAAUAA8BABNqYXZhL2lvL1ByaW50U3RyZWFtAQAFZmx1c2gBAC0oTGphdmEvaW8vUHJpbnRTdHJlYW07TGphdmEvaW8vUHJpbnRTdHJlYW07KVYBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQADcnVuAQAKU291cmNlRmlsZQEADENGSnVkZ2UuamF2YQEAD0VuY2xvc2luZ01ldGhvZAcAHQEAB0NGSnVkZ2UMAB8AIAEABG1haW4BABYoW0xqYXZhL2xhbmcvU3RyaW5nOylWAQAMSW5uZXJDbGFzc2VzACAAAgALAAAAAhAQAAUABgAAEBAACQAGAAAAAgAAAA4AFQABABYAAAAnAAIAAwAAAA8qK7UAASostQAHKrcACrEAAAABABcAAAAGAAEAAAAWAAEAGAAPAAEAFgAAACcAAQABAAAADyq0AAG2ABAqtAAHtgAQsQAAAAEAFwAAAAYAAQAAABcAAwAZAAAAAgAaABsAAAAEABwAHgAhAAAACgABAAIAAAAAAAA=',
  'CFJudge$2.class':
    'yv66vgAAADQANwkAAgADBwAEDAAFAAYBAAlDRkp1ZGdlJDIBAAd2YWwkbGltAQABSgkAAgAIDAAJAAoBAAd2YWwkb3V0AQAVTGphdmEvaW8vUHJpbnRTdHJlYW07CQACAAwMAA0ACgEAB3ZhbCRlcnIKAA8AEAcAEQwAEgATAQAQamF2YS9sYW5nL1RocmVhZAEABjxpbml0PgEAAygpVgoADwAVDAAWABcBAAVzbGVlcAEABChKKVYHABkBAB5qYXZhL2xhbmcvSW50ZXJydXB0ZWRFeGNlcHRpb24KABsAHAcAHQwAHgATAQATamF2YS9pby9QcmludFN0cmVhbQEABWZsdXNoCgAgACEHACIMACMAJAEAEWphdmEvbGFuZy9SdW50aW1lAQAKZ2V0UnVudGltZQEAFSgpTGphdmEvbGFuZy9SdW50aW1lOwoAIAAmDAAnACgBAARoYWx0AQAEKEkpVgEALihKTGphdmEvaW8vUHJpbnRTdHJlYW07TGphdmEvaW8vUHJpbnRTdHJlYW07KVYBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQADcnVuAQANU3RhY2tNYXBUYWJsZQEAClNvdXJjZUZpbGUBAAxDRkp1ZGdlLmphdmEBAA9FbmNsb3NpbmdNZXRob2QHADIBAAdDRkp1ZGdlDAA0ADUBAARtYWluAQAWKFtMamF2YS9sYW5nL1N0cmluZzspVgEADElubmVyQ2xhc3NlcwAgAAIADwAAAAMQEAAFAAYAABAQAAkACgAAEBAADQAKAAAAAgAAABIAKQABACoAAAAtAAMABQAAABUqH7UAASottQAHKhkEtQALKrcADrEAAAABACsAAAAGAAEAAAAcAAEALAATAAEAKgAAAFwAAgACAAAAIyq0AAG4ABSnAAVMsSq0AAe2ABoqtAALtgAauAAfEHy2ACWxAAEAAAAHAAoAGAACACsAAAASAAQAAAAeAAwAHwAaACAAIgAhAC0AAAAHAAJKBwAYAQADAC4AAAACAC8AMAAAAAQAMQAzADYAAAAKAAEAAgAAAAAAAA==',
};

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

let _ready = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureCheerpj() {
  if (_ready) return _ready;
  _ready = (async () => {
    try {
      await loadScript(CHEERPJ_LOADER);
      if (typeof window.cheerpjInit !== 'function') throw new Error('cheerpjInit missing after load');
      await window.cheerpjInit({ status: 'none' });
      const enc = new TextEncoder();
      for (const [name, b64] of Object.entries(HELPER_CLASSES)) {
        window.cheerpjAddStringFile(`/str/${name}`, b64ToBytes(b64));
      }
      // touch enc so bundlers don't drop it if the loop above is edited away
      void enc;
      return true;
    } catch (e) {
      _ready = null;
      throw new JavaUnavailable(`could not load the Java runtime: ${e.message}`);
    }
  })();
  return _ready;
}

/** Public class name, or first class declaring `static void main(String[])`. */
export function entryClass(src) {
  const clean = src
    .replace(/"""[\s\S]*?"""/g, '""').replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/'(\\.|[^'\\])*'/g, "''").replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const pub = clean.match(/public\s+(?:final\s+|abstract\s+)?class\s+(\w+)/);
  if (pub) return pub[1];
  for (const m of clean.matchAll(/\bclass\s+(\w+)/g)) {
    const body = clean.slice(m.index, m.index + 4000);
    if (/static[^;{}]*main\s*\(/.test(body)) return m[1];
  }
  return null;
}

async function readVfsText(path) {
  try {
    const blob = await window.cjFileBlob(path);
    return blob ? await blob.text() : '';
  } catch {
    return '';
  }
}

const MEM_RE = /OutOfMemoryError|java\.lang\.OutOfMemoryError/;

/**
 * @returns {Promise<{status:'OK'|'TLE'|'MLE'|'RE'|'CE', wallMs:number, memMb:number, stdout:string, error?:string, compileError?:string}>}
 */
export async function runJava(code, input, timeLimitMs, memLimitMb = Infinity, _lang = 'java') {
  const started = performance.now();
  try {
    await ensureCheerpj();
  } catch (e) {
    throw e instanceof JavaUnavailable ? e : new JavaUnavailable(String(e.message || e));
  }
  void memLimitMb;

  const cls = entryClass(code);
  if (!cls) {
    return { status: 'CE', wallMs: 0, memMb: 0, stdout: '', compileError: 'no class with `public static void main(String[])`' };
  }

  const enc = new TextEncoder();
  const srcPath = `/str/${cls}.java`;
  window.cheerpjAddStringFile(srcPath, enc.encode(code));
  window.cheerpjAddStringFile('/str/__stdin', enc.encode(String(input ?? '')));

  const CP = '/str/:/files/:/app/tools.jar';

  // ── compile (diagnostics → /files/__diag) ────────────────────────────────
  let compileCode;
  try {
    compileCode = await window.cheerpjRunMain(
      'CFJudge', CP, 'compile', srcPath, '-d', '/files/', '-encoding', 'UTF-8',
    );
  } catch (e) {
    return { status: 'CE', wallMs: Math.round(performance.now() - started), memMb: 0, stdout: '', compileError: String(e.message || e) };
  }
  if (compileCode !== 0) {
    const diag = (await readVfsText('/files/__diag')).replace(/\/str\//g, '');
    return { status: 'CE', wallMs: Math.round(performance.now() - started), memMb: 0, stdout: '', compileError: diag.trim() || 'compilation failed' };
  }

  // ── run (helper redirects System.in / out / err) ─────────────────────────
  const runStart = performance.now();
  const runPromise = window.cheerpjRunMain('CFJudge', CP, 'run', cls, '/str/__stdin', String(timeLimitMs))
    .then((rc) => ({ rc }))
    .catch((e) => ({ err: String(e && e.message || e) }));

  const outcome = await Promise.race([
    runPromise,
    new Promise((res) => setTimeout(() => res({ tle: true }), timeLimitMs + 1500)),
  ]);
  const wallMs = Math.round(performance.now() - runStart);
  const stdout = await readVfsText('/files/__out');
  const stderr = await readVfsText('/files/__err');

  if (outcome.tle || outcome.rc === 124) return { status: 'TLE', wallMs, memMb: 0, stdout };
  if (MEM_RE.test(stderr)) return { status: 'MLE', wallMs, memMb: 0, stdout };
  if (outcome.err) return { status: 'RE', wallMs, memMb: 0, stdout, error: outcome.err };
  if (wallMs > timeLimitMs) return { status: 'TLE', wallMs, memMb: 0, stdout };
  if (outcome.rc !== 0 || stderr.trim()) {
    return { status: 'RE', wallMs, memMb: 0, stdout, error: stderr.trim() || `exit ${outcome.rc}` };
  }
  return { status: 'OK', wallMs, memMb: 0, stdout };
}

/** "Does CheerpJ load, compile and run?" — cached by index.js. */
export async function javaSmokeTest() {
  try {
    const r = await runJava(
      'import java.util.*;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.print(s.nextInt()*2);}}',
      '21\n', 20000, 128,
    );
    return { ok: r.status === 'OK' && r.stdout.trim() === '42', error: r.error || r.compileError || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
