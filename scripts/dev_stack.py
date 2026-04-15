from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def spawn(label: str, command: list[str]) -> subprocess.Popen:
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{ROOT}:{ROOT / 'shared/python'}"
    print(f"starting {label}: {' '.join(command)}")
    return subprocess.Popen(command, cwd=ROOT, env=env)


def main() -> int:
    preflight = subprocess.run([sys.executable, "scripts/check_local_stack.py"], cwd=ROOT)
    if preflight.returncode != 0:
        return preflight.returncode

    processes = [
        ("platform-api", spawn("platform-api", [sys.executable, "-m", "uvicorn", "services.platform_api.app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"])),
        ("compiler-worker", spawn("compiler-worker", [sys.executable, "-m", "services.compiler_worker.app.main"])),
        ("mcp-service", spawn("mcp-service", [sys.executable, "-m", "uvicorn", "services.mcp_service.app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8080"])),
        ("converter-service", spawn("converter-service", [sys.executable, "-m", "uvicorn", "services.converter_service.app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8090"])),
        ("web", spawn("web", ["bun", "--cwd", "web", "dev"]))
    ]

    try:
        while True:
            for label, process in processes:
                code = process.poll()
                if code is not None:
                    print(f"{label} exited with code {code}", file=sys.stderr)
                    return code
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for _, process in processes:
            if process.poll() is None:
                process.terminate()
        for _, process in processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
