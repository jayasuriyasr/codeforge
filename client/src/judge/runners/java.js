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

import { javaCompilerHosted, JAVA_NOT_HOSTED } from '../loader.js';

const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js';

export class JavaUnavailable extends Error {
  constructor(msg) { super(msg); this.name = 'ToolchainUnavailable'; this.toolchain = 'java'; }
}

// CFJudge{,$1,$2,$DirLoader}.class — compiled from scripts/java-helper/CFJudge.java with
// `javac --release 8` (Java 8 bytecode is what CheerpJ's tools.jar expects).
// If you edit the .java, run scripts/java-helper/build.sh and paste the output here.
const HELPER_CLASSES = {
  'CFJudge$1.class':
    'yv66vgAAADQAIgkAAgADBwAEDAAFAAYBAAlDRkp1ZGdlJDEBAAd2YWwkb3V0AQAVTGphdmEvaW8vUHJpbnRTdHJlYW07CQACAAgMAAkABgEAB3ZhbCRlcnIKAAsADAcADQwADgAPAQAQamF2YS9sYW5nL1RocmVhZAEABjxpbml0PgEAAygpVgoAEQASBwATDAAUAA8BABNqYXZhL2lvL1ByaW50U3RyZWFtAQAFZmx1c2gBAC0oTGphdmEvaW8vUHJpbnRTdHJlYW07TGphdmEvaW8vUHJpbnRTdHJlYW07KVYBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQADcnVuAQAKU291cmNlRmlsZQEADENGSnVkZ2UuamF2YQEAD0VuY2xvc2luZ01ldGhvZAcAHQEAB0NGSnVkZ2UMAB8AIAEABG1haW4BABYoW0xqYXZhL2xhbmcvU3RyaW5nOylWAQAMSW5uZXJDbGFzc2VzACAAAgALAAAAAhAQAAUABgAAEBAACQAGAAAAAgAAAA4AFQABABYAAAAnAAIAAwAAAA8qK7UAASostQAHKrcACrEAAAABABcAAAAGAAEAAABAAAEAGAAPAAEAFgAAACcAAQABAAAADyq0AAG2ABAqtAAHtgAQsQAAAAEAFwAAAAYAAQAAAEEAAwAZAAAAAgAaABsAAAAEABwAHgAhAAAACgABAAIAAAAAAAA=',
  'CFJudge$2.class':
    'yv66vgAAADQANwkAAgADBwAEDAAFAAYBAAlDRkp1ZGdlJDIBAAd2YWwkbGltAQABSgkAAgAIDAAJAAoBAAd2YWwkb3V0AQAVTGphdmEvaW8vUHJpbnRTdHJlYW07CQACAAwMAA0ACgEAB3ZhbCRlcnIKAA8AEAcAEQwAEgATAQAQamF2YS9sYW5nL1RocmVhZAEABjxpbml0PgEAAygpVgoADwAVDAAWABcBAAVzbGVlcAEABChKKVYHABkBAB5qYXZhL2xhbmcvSW50ZXJydXB0ZWRFeGNlcHRpb24KABsAHAcAHQwAHgATAQATamF2YS9pby9QcmludFN0cmVhbQEABWZsdXNoCgAgACEHACIMACMAJAEAEWphdmEvbGFuZy9SdW50aW1lAQAKZ2V0UnVudGltZQEAFSgpTGphdmEvbGFuZy9SdW50aW1lOwoAIAAmDAAnACgBAARoYWx0AQAEKEkpVgEALihKTGphdmEvaW8vUHJpbnRTdHJlYW07TGphdmEvaW8vUHJpbnRTdHJlYW07KVYBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQADcnVuAQANU3RhY2tNYXBUYWJsZQEAClNvdXJjZUZpbGUBAAxDRkp1ZGdlLmphdmEBAA9FbmNsb3NpbmdNZXRob2QHADIBAAdDRkp1ZGdlDAA0ADUBAARtYWluAQAWKFtMamF2YS9sYW5nL1N0cmluZzspVgEADElubmVyQ2xhc3NlcwAgAAIADwAAAAMQEAAFAAYAABAQAAkACgAAEBAADQAKAAAAAgAAABIAKQABACoAAAAtAAMABQAAABUqH7UAASottQAHKhkEtQALKrcADrEAAAABACsAAAAGAAEAAABGAAEALAATAAEAKgAAAFwAAgACAAAAIyq0AAG4ABSnAAVMsSq0AAe2ABoqtAALtgAauAAfEHy2ACWxAAEAAAAHAAoAGAACACsAAAASAAQAAABIAAwASQAaAEoAIgBLAC0AAAAHAAJKBwAYAQADAC4AAAACAC8AMAAAAAQAMQAzADYAAAAKAAEAAgAAAAAAAA==',
  'CFJudge$DirLoader.class':
    'yv66vgAAADQAYQoAAgADBwAEDAAFAAYBABVqYXZhL2xhbmcvQ2xhc3NMb2FkZXIBAAY8aW5pdD4BABooTGphdmEvbGFuZy9DbGFzc0xvYWRlcjspVggACAEAAS8KAAoACwcADAwADQAOAQAQamF2YS9sYW5nL1N0cmluZwEACGVuZHNXaXRoAQAVKExqYXZhL2xhbmcvU3RyaW5nOylaBwAQAQAXamF2YS9sYW5nL1N0cmluZ0J1aWxkZXIKAA8AEgwABQATAQADKClWCgAPABUMABYAFwEABmFwcGVuZAEALShMamF2YS9sYW5nL1N0cmluZzspTGphdmEvbGFuZy9TdHJpbmdCdWlsZGVyOwoADwAZDAAaABsBAAh0b1N0cmluZwEAFCgpTGphdmEvbGFuZy9TdHJpbmc7CQAdAB4HAB8MACAAIQEAEUNGSnVkZ2UkRGlyTG9hZGVyAQADZGlyAQASTGphdmEvbGFuZy9TdHJpbmc7BwAjAQAXamF2YS9pby9GaWxlSW5wdXRTdHJlYW0KAAoAJQwAJgAnAQAHcmVwbGFjZQEAFihDQylMamF2YS9sYW5nL1N0cmluZzsIACkBAAYuY2xhc3MKACIAKwwABQAsAQAVKExqYXZhL2xhbmcvU3RyaW5nOylWBwAuAQAdamF2YS9pby9CeXRlQXJyYXlPdXRwdXRTdHJlYW0KAC0AEgoAMQAyBwAzDAA0ADUBABNqYXZhL2lvL0lucHV0U3RyZWFtAQAEcmVhZAEABShbQilJCgAtADcMADgAOQEABXdyaXRlAQAHKFtCSUkpVgoALQA7DAA8AD0BAAt0b0J5dGVBcnJheQEABCgpW0IKAB0APwwAQABBAQALZGVmaW5lQ2xhc3MBACkoTGphdmEvbGFuZy9TdHJpbmc7W0JJSSlMamF2YS9sYW5nL0NsYXNzOwoAMQBDDABEABMBAAVjbG9zZQcARgEAE2phdmEvaW8vSU9FeGNlcHRpb24HAEgBACBqYXZhL2xhbmcvQ2xhc3NOb3RGb3VuZEV4Y2VwdGlvbgoARwBKDAAFAEsBACooTGphdmEvbGFuZy9TdHJpbmc7TGphdmEvbGFuZy9UaHJvd2FibGU7KVYBACwoTGphdmEvbGFuZy9TdHJpbmc7TGphdmEvbGFuZy9DbGFzc0xvYWRlcjspVgEABENvZGUBAA9MaW5lTnVtYmVyVGFibGUBAA1TdGFja01hcFRhYmxlAQAJZmluZENsYXNzAQAlKExqYXZhL2xhbmcvU3RyaW5nOylMamF2YS9sYW5nL0NsYXNzOwcAUwEAAltCBwBVAQAPamF2YS9sYW5nL0NsYXNzBwBXAQATamF2YS9sYW5nL1Rocm93YWJsZQEACkV4Y2VwdGlvbnMBAAlTaWduYXR1cmUBACgoTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvQ2xhc3M8Kj47AQAKU291cmNlRmlsZQEADENGSnVkZ2UuamF2YQEADElubmVyQ2xhc3NlcwcAXwEAB0NGSnVkZ2UBAAlEaXJMb2FkZXIAMAAdAAIAAAABABIAIAAhAAAAAgAAAAUATAABAE0AAABzAAMAAwAAACoqLLcAASorEge2AAmZAAcrpwAWuwAPWbcAESu2ABQSB7YAFLYAGLUAHLEAAAACAE4AAAAGAAEAAAAMAE8AAAArAAL/ABMAAwcAHQcACgcAAgABBwAd/wASAAMHAB0HAAoHAAIAAgcAHQcACgAEAFAAUQADAE0AAAFqAAYACgAAAJIBTbsAIlm7AA9ZtwARKrQAHLYAFCsQLhAvtgAktgAUEii2ABS2ABi3ACpNuwAtWbcAL04RIAC8CDoELBkEtgAwWTYFngAPLRkEAxUFtgA2p//rLbYAOjoFKisZBQMZBb62AD46BizGAAwstgBCpwAFOgcZBrBOuwBHWSsttwBJvzoILMYADCy2AEKnAAU6CRkIvwAFAGkAbQBwAEUAAgBlAHUARQACAGUAgAAAAIYAigCNAEUAdQCCAIAAAAACAE4AAAA2AA0AAAAOAAIAEAArABEAMwASADoAEwBSABQAWAAVAGUAGQByABUAdQAWAHYAFwCAABkAjwAaAE8AAABiAAj+ADoHADEHAC0HAFIX/wAdAAcHAB0HAAoHADEHAC0HAFIHAFIHAFQAAQcARQH/AAIAAwcAHQcACgcAMQABBwBFSgcAVv8ADAAJBwAdBwAKBwAxAAAAAAAHAFYAAQcARQEAWAAAAAQAAQBHAFkAAAACAFoAAgBbAAAAAgBcAF0AAAAKAAEAHQBeAGAAGA==',
  'CFJudge.class':
    'yv66vgAAADQA1goAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWCAAIAQAHY29tcGlsZQoACgALBwAMDAANAA4BABBqYXZhL2xhbmcvU3RyaW5nAQAGZXF1YWxzAQAVKExqYXZhL2xhbmcvT2JqZWN0OylaCgAQABEHABIMABMAFAEAEGphdmEvbGFuZy9TeXN0ZW0BAAlhcnJheWNvcHkBACooTGphdmEvbGFuZy9PYmplY3Q7SUxqYXZhL2xhbmcvT2JqZWN0O0lJKVYIABYBAAItZAcAGAEADGphdmEvaW8vRmlsZQoAFwAaDAAFABsBABUoTGphdmEvbGFuZy9TdHJpbmc7KVYKABcAHQwAHgAfAQAGbWtkaXJzAQADKClaBwAhAQATamF2YS9pby9QcmludFdyaXRlcgcAIwEAGmphdmEvaW8vT3V0cHV0U3RyZWFtV3JpdGVyBwAlAQAYamF2YS9pby9GaWxlT3V0cHV0U3RyZWFtCAAnAQANL2ZpbGVzL19fZGlhZwoAJAAaCAAqAQAFVVRGLTgKACIALAwABQAtAQArKExqYXZhL2lvL091dHB1dFN0cmVhbTtMamF2YS9sYW5nL1N0cmluZzspVgoAIAAvDAAFADABABMoTGphdmEvaW8vV3JpdGVyOylWCAAyAQAYY29tLnN1bi50b29scy5qYXZhYy5NYWluCgA0ADUHADYMADcAOAEAD2phdmEvbGFuZy9DbGFzcwEAB2Zvck5hbWUBACUoTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvQ2xhc3M7BwA6AQATW0xqYXZhL2xhbmcvU3RyaW5nOwoANAA8DAA9AD4BAAlnZXRNZXRob2QBAEAoTGphdmEvbGFuZy9TdHJpbmc7W0xqYXZhL2xhbmcvQ2xhc3M7KUxqYXZhL2xhbmcvcmVmbGVjdC9NZXRob2Q7BwBAAQATamF2YS9sYW5nL1Rocm93YWJsZQcAQgEAF2phdmEvbGFuZy9TdHJpbmdCdWlsZGVyCgBBAAMIAEUBAC9qYXZhYyBpcyBub3QgYXZhaWxhYmxlICh0b29scy5qYXIgaXMgbWlzc2luZyk6IAoAQQBHDABIAEkBAAZhcHBlbmQBAC0oTGphdmEvbGFuZy9TdHJpbmc7KUxqYXZhL2xhbmcvU3RyaW5nQnVpbGRlcjsKAEEASwwASABMAQAtKExqYXZhL2xhbmcvT2JqZWN0OylMamF2YS9sYW5nL1N0cmluZ0J1aWxkZXI7CgBBAE4MAE8AUAEACHRvU3RyaW5nAQAUKClMamF2YS9sYW5nL1N0cmluZzsKACAAUgwAUwAbAQAHcHJpbnRsbgoAIABVDABWAAYBAAVmbHVzaAoAIABYDABZAAYBAAVjbG9zZQoAEABbDABcAF0BAARleGl0AQAEKEkpVgoAXwBgBwBhDABiAGMBABhqYXZhL2xhbmcvcmVmbGVjdC9NZXRob2QBAAZpbnZva2UBADkoTGphdmEvbGFuZy9PYmplY3Q7W0xqYXZhL2xhbmcvT2JqZWN0OylMamF2YS9sYW5nL09iamVjdDsHAGUBABFqYXZhL2xhbmcvSW50ZWdlcgoAZABnDABoAGkBAAhpbnRWYWx1ZQEAAygpSQcAawEAF2phdmEvaW8vRmlsZUlucHV0U3RyZWFtCgBqABoKABAAbgwAbwBwAQAFc2V0SW4BABgoTGphdmEvaW8vSW5wdXRTdHJlYW07KVYHAHIBABNqYXZhL2lvL1ByaW50U3RyZWFtBwB0AQAcamF2YS9pby9CdWZmZXJlZE91dHB1dFN0cmVhbQgAdgEADC9maWxlcy9fX291dAMAAQAACgBzAHkMAAUAegEAGihMamF2YS9pby9PdXRwdXRTdHJlYW07SSlWCgBxAHwMAAUAfQEALChMamF2YS9pby9PdXRwdXRTdHJlYW07WkxqYXZhL2xhbmcvU3RyaW5nOylWCAB/AQAML2ZpbGVzL19fZXJyCgAQAIEMAIIAgwEABnNldE91dAEAGChMamF2YS9pby9QcmludFN0cmVhbTspVgoAEACFDACGAIMBAAZzZXRFcnIKAIgAiQcAigwAiwCMAQARamF2YS9sYW5nL1J1bnRpbWUBAApnZXRSdW50aW1lAQAVKClMamF2YS9sYW5nL1J1bnRpbWU7BwCOAQAJQ0ZKdWRnZSQxCgCNAJAMAAUAkQEALShMamF2YS9pby9QcmludFN0cmVhbTtMamF2YS9pby9QcmludFN0cmVhbTspVgoAiACTDACUAJUBAA9hZGRTaHV0ZG93bkhvb2sBABUoTGphdmEvbGFuZy9UaHJlYWQ7KVYFAAAAAAAAJxAKAJkAmgcAmwwAnACdAQAOamF2YS9sYW5nL0xvbmcBAAlwYXJzZUxvbmcBABUoTGphdmEvbGFuZy9TdHJpbmc7KUoHAJ8BABNqYXZhL2xhbmcvRXhjZXB0aW9uBQAAAAAAAAH0BwCjAQAJQ0ZKdWRnZSQyCgCiAKUMAAUApgEALihKTGphdmEvaW8vUHJpbnRTdHJlYW07TGphdmEvaW8vUHJpbnRTdHJlYW07KVYKAKgAqQcAqgwAqwCsAQAQamF2YS9sYW5nL1RocmVhZAEACXNldERhZW1vbgEABChaKVYKAKgArgwArwAGAQAFc3RhcnQHALEBABFDRkp1ZGdlJERpckxvYWRlcgcAswEAB0NGSnVkZ2UKADQAtQwAtgC3AQAOZ2V0Q2xhc3NMb2FkZXIBABkoKUxqYXZhL2xhbmcvQ2xhc3NMb2FkZXI7CgCwALkMAAUAugEALChMamF2YS9sYW5nL1N0cmluZztMamF2YS9sYW5nL0NsYXNzTG9hZGVyOylWCgA0ALwMADcAvQEAPShMamF2YS9sYW5nL1N0cmluZztaTGphdmEvbGFuZy9DbGFzc0xvYWRlcjspTGphdmEvbGFuZy9DbGFzczsIAL8BAARtYWluCgBfAMEMAMIArAEADXNldEFjY2Vzc2libGUHAMQBACtqYXZhL2xhbmcvcmVmbGVjdC9JbnZvY2F0aW9uVGFyZ2V0RXhjZXB0aW9uCgDDAMYMAMcAyAEACGdldENhdXNlAQAXKClMamF2YS9sYW5nL1Rocm93YWJsZTsKAD8AygwAywCDAQAPcHJpbnRTdGFja1RyYWNlCgBxAFUBAARDb2RlAQAPTGluZU51bWJlclRhYmxlAQAWKFtMamF2YS9sYW5nL1N0cmluZzspVgEADVN0YWNrTWFwVGFibGUBAApFeGNlcHRpb25zAQAKU291cmNlRmlsZQEADENGSnVkZ2UuamF2YQEADElubmVyQ2xhc3NlcwEACURpckxvYWRlcgAhALIAAgAAAAAAAgABAAUABgABAM0AAAAdAAEAAQAAAAUqtwABsQAAAAEAzgAAAAYAAQAAAAQACQC/AM8AAgDNAAADcgAHAAwAAAHmKr6eAM0qAzISB7YACZkAwiq+BGS9AApMKgQrAyu+uAAPAz0cBGArvqIAJCscMhIVtgAJmQATuwAXWSscBGAytwAZtgAcV4QCAaf/2rsAIFm7ACJZuwAkWRImtwAoEim3ACu3AC5NEjG4ADMSBwW9ADRZAxI5U1kEEiBTtgA7TqcAKjoELLsAQVm3AEMSRLYARhkEtgBKtgBNtgBRLLYAVCy2AFcGuABasS0BBb0AAlkDK1NZBCxTtgBewABktgBmNgQstgBULLYAVxUEuABaKgQyTLsAalkqBTK3AGy4AG27AHFZuwBzWbsAJFkSdbcAKBJ3twB4AxIptwB7TbsAcVm7ACRZEn63ACgEEim3AHtOLLgAgC24AIS4AIe7AI1ZLC23AI+2AJIUAJY3BCoGMrgAmDcEpwAFOgYWBBQAoGE3BrsAolkWBiwttwCkOggZCAS2AKcZCLYArQM2CSq+B6QAHCsEuwCwWSoHMhKytgC0twC4uAC7OgqnAAkruAAzOgoZChK+BL0ANFkDEjlTtgA7OgsZCwS2AMAZCwEEvQACWQMDvQAKU7YAXlenACw6ChkKtgDFxwAIGQqnAAgZCrYAxS22AMkENgmnAA46ChkKLbYAyQQ2CSy2AMwttgDMFQm4AFqxAAQAZgB/AIIAPwEtATUBOACeAV0BrAGvAMMBXQGsAc0APwACAM4AAADCADAAAAAfABAAIgAYACMAIQAkACsAJQBGACQATAAnAGYALQB7AC4AfwA0AIIALwCEADAAnAAxAKQAMgCoADMAqQA1AMIANgDKADcAzwA6ANMAOwDgADwA/QA+AREAPwEZAEABKABDAS0ARAE6AEUBQgBGAU8ATQFVAE4BWgBPAV0AVQFjAFYBfABYAYIAWgGUAFsBmgBcAawAYwGvAF0BsQBeAccAXwHKAGMBzQBgAc8AYQHVAGIB2ABkAeAAZQHlAGYA0AAAAJIAD/0AIwcAOQEi+gAF/wA1AAMHADkHADkHACAAAQcAP/wAJgcAX/gAJf8AaAAFBwA5BwAKBwBxBwBxBAABBwCeAf4AQQQHAKgB/AAFBwA0/wAsAAgHADkHAAoHAHEHAHEEBAcAqAEAAQcAw/wADgcAw0QHAD//AAkACAcAOQcACgcAcQcAcQQEBwCoAQABBwA/CgDRAAAABAABAJ4AAgDSAAAAAgDTANQAAAAaAAMAjQAAAAAAAACiAAAAAAAAALAAsgDVABg=',
};

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

let _ready = null;

// ── Cross-origin isolation vs. CheerpJ ─────────────────────────────────────
// The site is cross-origin isolated (COOP + COEP: require-corp) because the
// C/C++ toolchain needs SharedArrayBuffer. CheerpJ runs part of its runtime in
// a hidden iframe from cjrtnc.leaningtech.com, and that page sends no COEP/CORP
// headers — so an isolated page may not embed it and Java waited forever.
// Chrome / Edge (110+) can embed such a frame when it is marked `credentialless`
// (it then gets its own throw-away storage). Firefox / Safari can't, so there
// we say so up front instead of hanging.
const IFRAME_CREDENTIALLESS = typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype;
let _iframePatched = false;

function allowCheerpjFrame() {
  if (_iframePatched || !self.crossOriginIsolated || !IFRAME_CREDENTIALLESS) return;
  _iframePatched = true;
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function createElement(tag, opts) {
    const el = create.call(this, tag, opts);
    if (String(tag).toLowerCase() === 'iframe') el.credentialless = true;   // set before CheerpJ assigns src
    return el;
  };
}

/** Reject if `promise` hasn't settled within `ms`. */
function within(ms, promise, what) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} did not finish within ${Math.round(ms / 1000)} s`)), ms)),
  ]);
}

const INIT_TIMEOUT_MS = 90_000;
const FIRST_COMPILE_TIMEOUT_MS = 180_000;   // first javac run streams the JDK in
const COMPILE_TIMEOUT_MS = 60_000;
let _compiledOnce = false;
// judgePractice calls runJava once per test case with the same code — compile
// once and reuse the classes in /files/ (javac in a WebAssembly JVM takes seconds).
let _lastCompile = null;   // { code, compileError: string|null, outDir }
let _buildSeq = 0;

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
      if (self.crossOriginIsolated && !IFRAME_CREDENTIALLESS) {
        throw new Error('on this site Java needs Chrome or Edge — this browser cannot load the Java runtime on a cross-origin-isolated page');
      }
      if (!(await javaCompilerHosted())) throw new Error(JAVA_NOT_HOSTED);
      allowCheerpjFrame();
      await loadScript(CHEERPJ_LOADER);
      if (typeof window.cheerpjInit !== 'function') throw new Error('cheerpjInit missing after load');
      await within(INIT_TIMEOUT_MS, window.cheerpjInit({ status: 'none' }), 'starting the Java runtime');
      const enc = new TextEncoder();
      for (const [name, b64] of Object.entries(HELPER_CLASSES)) {
        window.cheerpjAddStringFile(`/str/${name}`, b64ToBytes(b64));
      }
      // touch enc so bundlers don't drop it if the loop above is edited away
      void enc;
      return true;
    } catch (e) {
      _ready = null;
      throw new JavaUnavailable(e.message === JAVA_NOT_HOSTED ? JAVA_NOT_HOSTED : `could not load the Java runtime: ${e.message}`);
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

  // ── compile (diagnostics → /files/__diag), once per distinct source ──────
  if (!_lastCompile || _lastCompile.code !== code) {
    _lastCompile = null;
    // A fresh output directory per build: the JVM's class path is fixed when
    // CheerpJ starts, so the helper loads the class from here with its own
    // class loader (Class.forName on the system loader never saw it).
    const outDir = `/files/build${++_buildSeq}-${Date.now().toString(36)}/`;
    let compileCode;
    try {
      compileCode = await within(
        _compiledOnce ? COMPILE_TIMEOUT_MS : FIRST_COMPILE_TIMEOUT_MS,
        window.cheerpjRunMain('CFJudge', CP, 'compile', srcPath, '-d', outDir, '-encoding', 'UTF-8'),
        'compiling Java',
      );
    } catch (e) {
      if (/did not finish within/.test(String(e.message))) throw new JavaUnavailable(`the Java runtime stopped responding (${e.message})`);
      _lastCompile = { code, compileError: String(e.message || e), outDir };
      return { status: 'CE', wallMs: Math.round(performance.now() - started), memMb: 0, stdout: '', compileError: _lastCompile.compileError };
    }
    _compiledOnce = true;
    if (compileCode === 3) {   // the helper's "javac missing" exit
      throw new JavaUnavailable((await readVfsText('/files/__diag')).trim() || JAVA_NOT_HOSTED);
    }
    if (compileCode !== 0) {
      const diag = (await readVfsText('/files/__diag')).replace(/\/str\//g, '');
      _lastCompile = { code, compileError: diag.trim() || 'compilation failed', outDir };
    } else {
      _lastCompile = { code, compileError: null, outDir };
    }
  }
  if (_lastCompile.compileError) {
    return { status: 'CE', wallMs: Math.round(performance.now() - started), memMb: 0, stdout: '', compileError: _lastCompile.compileError };
  }

  // ── run (helper redirects System.in / out / err) ─────────────────────────
  const runStart = performance.now();
  const runPromise = window.cheerpjRunMain('CFJudge', CP, 'run', cls, '/str/__stdin', String(timeLimitMs), _lastCompile.outDir)
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
