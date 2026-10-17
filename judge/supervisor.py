#!/usr/bin/env python3
"""
CodeForge Arena — in-sandbox execution supervisor (v4).

Runs INSIDE an ephemeral judge container. Invoked by the worker via:

    docker exec -i <sandbox> python3 /opt/supervisor.py compile   < spec.json
    docker exec -i <sandbox> python3 /opt/supervisor.py run       < spec.json

`compile` writes the source into /workspace and runs the compile command under a
fixed timeout. `run` executes every test case as its OWN child process, each with
its own wall-clock timeout and its own peak-RSS measurement, and reports a
per-case result. The worker runs the checker (AC/WA) on the captured stdout — the
supervisor never sees expected output.

Result: a single JSON object on stdout. Diagnostics go to stderr.

Design notes
------------
* Memory: the container cgroup is a generous host-protection ceiling (≈512 MB).
  The *problem's* memory limit is enforced by measurement — we read the kernel's
  own high-water mark (`/proc/<pid>/status:VmHWM`) and declare MLE if it exceeds
  the limit, or if the container cgroup OOM-killer fired
  (`/sys/fs/cgroup/memory.events:oom_kill` delta). This is exact and uniform
  across languages — no `ulimit -v`, so the JVM is judged on real RSS, not on the
  virtual address space it reserves.
* Time: monotonic wall clock. A case is TLE if it had to be killed for running
  over, or if it finished later than the limit.
* Each case runs in its own session (`start_new_session=True`) so a timeout kills
  the whole process group, not just the leader.
"""

import base64
import json
import os
import signal
import subprocess
import sys
import threading
import time

WORKSPACE = "/workspace"
CGROUP_EVENTS = "/sys/fs/cgroup/memory.events"


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def read_oom_kill_count():
    """Container cgroup v2 oom_kill counter, or 0 if unreadable."""
    try:
        with open(CGROUP_EVENTS) as f:
            for line in f:
                if line.startswith("oom_kill "):
                    return int(line.split()[1])
    except Exception:
        pass
    return 0


def read_vm_hwm_kb(pid):
    """Peak resident set size of a process in KB, from /proc/<pid>/status."""
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmHWM:"):
                    return int(line.split()[1])
    except Exception:
        pass
    return 0


class PeakSampler(threading.Thread):
    """Polls VmHWM for a pid until stopped; keeps the max seen.

    VmHWM is a kernel-maintained high-water mark, so even if we miss the exact
    instant of peak usage the value we read is still the true peak up to that
    point. Polling just makes sure we read it before /proc/<pid> disappears.
    """

    def __init__(self, pid):
        super().__init__(daemon=True)
        self.pid = pid
        self.peak_kb = 0
        self._stop = threading.Event()

    def run(self):
        while not self._stop.is_set():
            v = read_vm_hwm_kb(self.pid)
            if v > self.peak_kb:
                self.peak_kb = v
            time.sleep(0.003)

    def stop(self):
        self._stop.set()
        v = read_vm_hwm_kb(self.pid)
        if v > self.peak_kb:
            self.peak_kb = v


def write_source(spec):
    path = os.path.join(WORKSPACE, spec["source_filename"])
    with open(path, "wb") as f:
        f.write(base64.b64decode(spec["source_b64"]))
    return path


def do_compile(spec):
    write_source(spec)
    cmd = spec.get("compile_cmd")
    if not cmd:
        return {"ok": True, "ms": 0, "stderr": ""}

    timeout_s = spec.get("compile_timeout_ms", 10000) / 1000.0
    t0 = time.monotonic()
    try:
        p = subprocess.run(
            ["bash", "-c", cmd],
            cwd=WORKSPACE,
            capture_output=True,
            timeout=timeout_s,
        )
        ms = int((time.monotonic() - t0) * 1000)
        if p.returncode != 0:
            return {"ok": False, "ms": ms,
                    "stderr": (p.stderr or b"").decode("utf-8", "replace")[:8192]}
        return {"ok": True, "ms": ms, "stderr": ""}
    except subprocess.TimeoutExpired:
        return {"ok": False, "ms": int(timeout_s * 1000),
                "stderr": f"compilation timed out after {timeout_s:g}s"}


def run_case(case, spec):
    run_cmd = spec["run_cmd"]
    limit_ms = spec["time_limit_ms"]
    limit_mb = spec["memory_limit_mb"]
    slack_mb = spec.get("mle_slack_mb", 8)
    cap = spec.get("output_cap_bytes", 64 * 1024 * 1024)

    stdin_bytes = base64.b64decode(case.get("input_b64", ""))

    oom_before = read_oom_kill_count()
    t0 = time.monotonic()

    proc = subprocess.Popen(
        ["bash", "-lc", run_cmd],
        cwd=WORKSPACE,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    sampler = PeakSampler(proc.pid)
    sampler.start()

    out = bytearray()
    err = bytearray()
    over_output = False

    def pump(stream, buf, is_stdout):
        nonlocal over_output
        try:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    break
                if len(buf) < cap:
                    buf.extend(chunk[: cap - len(buf)])
                elif is_stdout:
                    over_output = True
                    break
        except Exception:
            pass

    t_out = threading.Thread(target=pump, args=(proc.stdout, out, True), daemon=True)
    t_err = threading.Thread(target=pump, args=(proc.stderr, err, False), daemon=True)
    t_out.start()
    t_err.start()

    try:
        proc.stdin.write(stdin_bytes)
    except (BrokenPipeError, OSError):
        pass
    try:
        proc.stdin.close()
    except OSError:
        pass

    killed_timeout = False
    grace_s = limit_ms / 1000.0 + 0.5
    try:
        proc.wait(timeout=grace_s)
    except subprocess.TimeoutExpired:
        killed_timeout = True
        _killpg(proc)
        proc.wait()

    if over_output:
        _killpg(proc)
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass

    wall_ms = int((time.monotonic() - t0) * 1000)
    sampler.stop()
    t_out.join(timeout=1)
    t_err.join(timeout=1)

    oom = read_oom_kill_count() > oom_before
    peak_mb = round(sampler.peak_kb / 1024.0, 2)
    rc = proc.returncode
    sig = -rc if (rc is not None and rc < 0) else None

    # Classify — order matters: OOM beats TLE beats RE.
    if oom or peak_mb > limit_mb + slack_mb:
        status = "MLE"
    elif killed_timeout or wall_ms > limit_ms:
        status = "TLE"
    elif over_output:
        status = "OLE"
    elif rc != 0:
        status = "RE"
    else:
        status = "OK"

    return {
        "index": case["index"],
        "status": status,
        "exit_code": rc,
        "signal": sig,
        "wall_ms": wall_ms,
        "mem_mb": peak_mb,
        "oom": bool(oom),
        "stdout_b64": base64.b64encode(bytes(out)).decode(),
        "stderr_b64": base64.b64encode(bytes(err[:8192])).decode(),
    }


def _killpg(proc):
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


def do_run(spec):
    results = []
    stop_on_fail = spec.get("stop_on_first_fail", True)
    for case in spec["cases"]:
        r = run_case(case, spec)
        results.append(r)
        if stop_on_fail and r["status"] != "OK":
            break
    return {"cases": results}


def do_check(spec):
    """Special (custom) checker mode. Compiles the checker once, then per case
    runs  <checker> /workspace/in /workspace/out /workspace/exp  — exit 0 = AC,
    non-zero = WA, stdout = an optional message.
    """
    path = os.path.join(WORKSPACE, spec["checker_source_filename"])
    with open(path, "wb") as f:
        f.write(base64.b64decode(spec["checker_source_b64"]))

    compile_cmd = spec.get("checker_compile_cmd")
    if compile_cmd:
        c = subprocess.run(["bash", "-c", compile_cmd], cwd=WORKSPACE,
                           capture_output=True, timeout=spec.get("compile_timeout_ms", 10000) / 1000.0)
        if c.returncode != 0:
            return {"compile": {"ok": False, "stderr": (c.stderr or b"").decode("utf-8", "replace")[:8192]},
                    "cases": []}

    run_cmd = spec["checker_run_cmd"]
    tl = spec.get("time_limit_ms", 5000) / 1000.0
    results = []
    for case in spec["cases"]:
        for name, key in (("in", "input_b64"), ("out", "output_b64"), ("exp", "expected_b64")):
            with open(os.path.join(WORKSPACE, name), "wb") as f:
                f.write(base64.b64decode(case.get(key, "")))
        try:
            p = subprocess.run(["bash", "-c", run_cmd], cwd=WORKSPACE, capture_output=True, timeout=tl)
            results.append({
                "index": case["index"],
                "accepted": p.returncode == 0,
                "message": (p.stdout or p.stderr or b"").decode("utf-8", "replace")[:1024],
            })
        except subprocess.TimeoutExpired:
            results.append({"index": case["index"], "accepted": False, "message": "checker timed out"})
    return {"compile": {"ok": True}, "cases": results}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        spec = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad spec: {e}"}))
        return 1

    try:
        if mode == "compile":
            out = {"ok": True, "compile": do_compile(spec)}
        elif mode == "run":
            out = {"ok": True, **do_run(spec)}
        elif mode == "check":
            out = {"ok": True, **do_check(spec)}
        else:
            out = {"ok": False, "error": f"unknown mode: {mode!r}"}
    except Exception as e:  # supervisor bug / environment fault → infra, not a verdict
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
