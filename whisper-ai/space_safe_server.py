"""
Standard-library fallback server for Hugging Face Space safe mode.
"""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


START_TIME = time.time()


class _Handler(BaseHTTPRequestHandler):
    server_version = "WhisperSpaceSafe/1.0"

    def _write_json(self, payload: dict, status: int = 200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        uptime = int(time.time() - START_TIME)
        if self.path == "/":
            self._write_json(
                {
                    "status": "healthy",
                    "service": "whisper-ai",
                    "safe_mode": True,
                    "message": "Standard-library safe mode is running",
                    "health": "/api/health",
                }
            )
            return
        if self.path in ("/health", "/api/health"):
            self._write_json(
                {
                    "status": "ok",
                    "service": "whisper-ai",
                    "safe_mode": True,
                    "runtime": {
                        "configured_backend": "space-safe",
                        "active_backend": "space-safe",
                        "loaded": False,
                    },
                    "uptime": uptime,
                }
            )
            return
        if self.path == "/api/ping":
            self._write_json({"status": "pong", "safe_mode": True, "uptime": uptime})
            return
        self._write_json({"status": "not_found", "path": self.path}, status=404)

    def log_message(self, fmt: str, *args):
        print(f"[space_safe_server] {self.address_string()} - {fmt % args}", flush=True)


def serve(host: str, port: int):
    print(f"space_safe_server listening on http://{host}:{port}", flush=True)
    server = ThreadingHTTPServer((host, port), _Handler)
    server.serve_forever()
