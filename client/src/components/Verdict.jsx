import './Verdict.css';

const CLASS = { AC: 'v-ac', WA: 'v-wa', TLE: 'v-tle', MLE: 'v-mle', RE: 'v-re', CE: 'v-ce' };
const LABEL = {
  AC: 'Accepted', WA: 'Wrong Answer', TLE: 'Time Limit Exceeded',
  MLE: 'Memory Limit Exceeded', RE: 'Runtime Error', CE: 'Compile Error',
  UNAVAILABLE: 'Toolchain unavailable',
};

export function Chip({ v, children }) {
  return <span className={`v-chip ${CLASS[v] || 'v-neu'}`}>{children || v}</span>;
}

export default function Verdict({ result, running, progress, stage, onUseCase }) {
  if (running && !result) {
    return (
      <div className="v-panel v-running">
        <div className="v-running-row">
          <span className="v-spin" />
          <span>{stage || 'Judging in your browser…'}</span>
        </div>
        {progress && progress.total > 0 && (
          <div className="v-progress">
            <div className="v-progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}
      </div>
    );
  }
  if (!result) return null;

  const { verdict, runtimeMs, memoryMB, cases = [], failedTestCase, compileError, error } = result;

  return (
    <div className={`v-panel ${CLASS[verdict] ? `v-border-${CLASS[verdict]}` : ''}`}>
      <div className="v-head">
        <Chip v={verdict}>{verdict}</Chip>
        <span className="v-sub">{LABEL[verdict] || verdict}</span>
        {runtimeMs != null && verdict !== 'CE' && verdict !== 'UNAVAILABLE' && (
          <span className="v-stat">{runtimeMs} ms</span>
        )}
        {memoryMB ? <span className="v-stat">{memoryMB.toFixed(1)} MB</span> : null}
        <span className="v-note">judged in this browser — not an official verdict</span>
      </div>

      {verdict === 'UNAVAILABLE' && (
        <p className="v-msg">
          {error || 'This language toolchain could not be loaded.'} Check your connection and try again,
          or switch to JavaScript / Python (which need no compiler).
        </p>
      )}

      {compileError && (
        <div className="v-compile">
          <div className="v-compile-h">Compiler output</div>
          <pre>{compileError}</pre>
        </div>
      )}

      {cases.length > 0 && (
        <div className="v-cases">
          {cases.map((c) => (
            <span key={c.index} className={`v-case ${CLASS[c.status] || 'v-neu'}`}>
              #{c.index + 1} {c.status}
              {c.wallMs != null ? ` · ${c.wallMs}ms` : ''}
              {c.memMb ? ` · ${c.memMb.toFixed(0)}MB` : ''}
            </span>
          ))}
        </div>
      )}

      {failedTestCase && verdict !== 'CE' && (
        <div className="v-failed">
          <div className="v-failed-h">
            <span>Failed test case{failedTestCase.label ? ` — ${failedTestCase.label}` : ''}</span>
            {onUseCase && (
              <button onClick={() => onUseCase(failedTestCase)}>Load into editor input</button>
            )}
          </div>
          <div className="v-failed-cols">
            <div><label>Input</label><pre>{failedTestCase.input || '(empty)'}</pre></div>
            <div><label>Expected</label><pre>{failedTestCase.expectedOutput}</pre></div>
            <div><label>Your output</label><pre className="v-actual">{failedTestCase.actualOutput}</pre></div>
          </div>
        </div>
      )}
    </div>
  );
}
