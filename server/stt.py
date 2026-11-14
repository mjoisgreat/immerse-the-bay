"""Local speech-to-text sidecar for Living Window.

POST /transcribe with raw 16 kHz mono little-endian Int16 PCM -> {"text": "..."}.
Runs Whisper on the Mac's GPU via mlx-whisper, so the hall Wi-Fi only carries
the headset -> laptop audio, not a cloud round-trip.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import mlx_whisper
import numpy as np

MODEL = "mlx-community/whisper-large-v3-turbo"
PORT = 8790
LOCK = threading.Lock()  # MLX is not safe to call from several threads at once


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/transcribe":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        audio = np.frombuffer(self.rfile.read(n), np.int16).astype(np.float32) / 32768.0
        text = ""
        if audio.size > 1600:  # ignore taps shorter than 0.1 s
            with LOCK:
                r = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL, language="en",
                                           condition_on_previous_text=False)
            text = r["text"].strip()
        body = json.dumps({"text": text}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    # Warm the model so the first real utterance is fast.
    mlx_whisper.transcribe(np.zeros(16000, np.float32), path_or_hf_repo=MODEL, language="en")
    print(f"[stt] Whisper ready on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
