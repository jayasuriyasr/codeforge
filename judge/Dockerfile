# ────────────────────────────────────────────────────────────────────────────
# codeforge/fat-judge — hardened, single-use judge sandbox image (v4)
#
# Runtimes: GCC/G++ 12 (C/C++), OpenJDK 17 (LTS — text blocks/records/sealed
#           classes all supported), Python 3.11, Node.js 20
# Base: Debian Bookworm slim
#
# The container runs `--read-only` with only /workspace and /dev/shm writable
# (tmpfs, added at `docker run` time). One container judges exactly one
# submission and is then destroyed. The in-container supervisor
# (/opt/supervisor.py) runs each test case under its own timeout and measures
# peak RSS from /proc — so `procps` and a readable /proc are required.
# ────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS base

ARG DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ── System packages ────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      gcc g++ \
      python3 \
      openjdk-17-jdk-headless \
      coreutils procps bash \
      curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

RUN gcc --version && g++ --version && python3 --version && node --version && java --version

# ── Supervisor ─────────────────────────────────────────────────────────────
# root:root 0644 — world-readable, executed as `python3 /opt/supervisor.py`
# by the sandbox user (uid 1000).
COPY supervisor.py /opt/supervisor.py

# ── Sandbox user (uid/gid 1000) ────────────────────────────────────────────
RUN groupadd -g 1000 judge \
 && useradd -u 1000 -g judge -M -s /usr/sbin/nologin judge \
 && mkdir -p /workspace && chown 1000:1000 /workspace

CMD ["sleep", "infinity"]
