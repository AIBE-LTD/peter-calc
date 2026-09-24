"""Serve the built Peter calculator with its real local PDF endpoint."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import importlib.util
import json
import os

ROOT = Path(__file__).parent.resolve()
FRONTEND = ROOT / 'dist'
PORT = int(os.environ.get('PETER_PREVIEW_PORT', '4175'))
spec = importlib.util.spec_from_file_location('report_endpoint', ROOT / 'api/report.py')
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


class Preview(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def reply(self, status, body, content_type='text/plain; charset=utf-8', filename=None):
        return endpoint.handler.reply(self, status, body, content_type, filename)

    def send(self, status, body, content_type='text/plain; charset=utf-8'):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def list_directory(self, path):
        self.send_error(404, 'Not found')
        return None

    def do_GET(self):
        route = urlsplit(self.path).path
        if route == '/api/report':
            return endpoint.handler.do_GET(self)
        if route == '/api/prime-rate':
            return self.send(200, json.dumps({'ok': False}), 'application/json')
        if route.startswith('/api/'):
            return self.send(503, 'External submissions are disabled in local review.')
        return super().do_GET()

    def do_HEAD(self):
        route = urlsplit(self.path).path
        if route.startswith('/api/'):
            return self.send(503, 'External submissions are disabled in local review.')
        return super().do_HEAD()

    def do_POST(self):
        if urlsplit(self.path).path != '/api/report':
            return self.send(503, 'External submissions are disabled.')
        if self.headers.get('Origin') not in (None, f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'):
            return self.send(403, 'Forbidden')
        return endpoint.handler.do_POST(self)


if __name__ == '__main__':
    if not (FRONTEND / 'index.html').is_file():
        raise SystemExit('Run npm run build first, or use npm start.')
    print(f'Peter Calculator is ready at http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Preview).serve_forever()
