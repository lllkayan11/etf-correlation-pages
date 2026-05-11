import json
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self.path != "/refresh-yahoo":
            self.send_error(404, "Not Found")
            return
        try:
            subprocess.run(
                ["python3", str(ROOT_DIR / "fetch_yahoo_etf_data.py")],
                check=True,
                cwd=str(ROOT_DIR),
                capture_output=True,
                text=True,
            )
            payload = {"ok": True, "message": "Yahoo data refreshed."}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except subprocess.CalledProcessError as exc:
            payload = {"ok": False, "message": exc.stderr[-800:] if exc.stderr else str(exc)}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving {ROOT_DIR} on http://{HOST}:{PORT}")
    print("POST /refresh-yahoo to regenerate local Yahoo data JSON files.")
    server.serve_forever()
