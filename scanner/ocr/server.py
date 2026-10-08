"""Private, serial OCR sidecar. No database/storage credentials or outbound network."""
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
try:
    import resource
except ImportError:
    resource = None

MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 10
MAX_TEXT = 40000


def child_limits():
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))


def bounded_run(args, timeout, cwd):
    if resource is None:
        raise ValueError('Linux sandbox required')
    result = subprocess.run(args, cwd=cwd, timeout=timeout, capture_output=True,
                            env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': str(cwd), 'OMP_THREAD_LIMIT': '1'},
                            preexec_fn=child_limits, check=True)
    if len(result.stdout) > 250000 or len(result.stderr) > 250000:
        raise ValueError('Tool output exceeded limit')
    return result.stdout.decode('utf-8', errors='strict')


def process_pdf(data, run=bounded_run):
    if not 0 < len(data) <= MAX_BYTES or not data.startswith(b'%PDF-'):
        raise ValueError('Invalid PDF')
    deadline = time.monotonic() + 80
    with tempfile.TemporaryDirectory(prefix='ocr-') as folder:
        root = Path(folder)
        (root / 'input.pdf').write_bytes(data)
        info = run(['pdfinfo', 'input.pdf'], 10, root)
        counts = re.findall(r'^Pages:[ \t]*(\d+)[ \t]*$', info, re.MULTILINE)
        if len(counts) != 1 or not 1 <= int(counts[0]) <= MAX_PAGES:
            raise ValueError('PDF page limit exceeded')
        pages = int(counts[0])
        run(['pdftoppm', '-f', '1', '-l', str(pages), '-r', '150', '-scale-to', '1600', '-png', 'input.pdf', 'page'], 30, root)
        images = sorted(root.glob('page-*.png'), key=lambda p: int(p.stem.split('-')[-1]))
        if len(images) != pages:
            raise ValueError('Incomplete page rendering')
        text = []
        for image in images:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError('OCR timeout')
            text.append(run(['tesseract', image.name, 'stdout', '-l', 'eng', '--psm', '3', 'quiet'], min(15, remaining), root))
            if sum(len(part) for part in text) >= MAX_TEXT:
                break
        return '\n'.join(text)[:MAX_TEXT].strip()


class Handler(BaseHTTPRequestHandler):
    token = ''
    engine = ''

    def log_message(self, *args):
        pass

    def reply(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.connection.settimeout(10)
        if self.path != '/health' or not self.token or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.token):
            self.reply(403, {'error': 'OCR access denied'})
            return
        self.reply(200, {'engine': self.engine, 'ready': bool(self.engine)})

    def do_POST(self):
        self.connection.settimeout(10)
        if self.path == '/smoke' and self.token and hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.token):
            if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
                self.reply(413, {'error': 'Empty smoke request required'})
                return
            try:
                from smoke import run_smoke
                self.reply(200, {'fixture': run_smoke(), 'engine': self.engine})
            except Exception:
                self.reply(422, {'error': 'Native smoke acceptance incomplete'})
            return
        if self.path != '/extract' or not self.token or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.token):
            self.reply(403, {'error': 'OCR access denied'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BYTES or self.headers.get('Content-Type') != 'application/pdf' or self.headers.get('Transfer-Encoding'):
                self.reply(413, {'error': 'Invalid OCR request size/type'})
                return
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError('Incomplete PDF')
            text = process_pdf(data)
            self.reply(200, {'text': text, 'engine': self.engine})
        except Exception:
            self.reply(422, {'error': 'OCR could not complete within its limits'})


if __name__ == '__main__':
    Handler.token = os.environ.get('OCR_SHARED_TOKEN', '')
    if not 32 <= len(Handler.token) <= 512:
        raise SystemExit('Set a private OCR token of at least 32 characters')
    Handler.engine = bounded_run(['tesseract', '--version'], 10, Path('/tmp')).splitlines()[0][:120]
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
