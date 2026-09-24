"""Run the built Peter calculator: python preview.py (requires reportlab and Pillow)."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json, mimetypes, importlib.util, os

ROOT=Path(__file__).parent.resolve()
FRONTEND=ROOT/'dist'
PORT=int(os.environ.get('PETER_PREVIEW_PORT', '4175'))
spec=importlib.util.spec_from_file_location('report_endpoint',ROOT/'api/report.py')
endpoint=importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)
class Preview(BaseHTTPRequestHandler):
    def reply(self,status,body,content_type='text/plain; charset=utf-8',filename=None):
        return endpoint.handler.reply(self,status,body,content_type,filename)
    def send(self,status,body,content_type='text/plain; charset=utf-8',attachment=None):
        if isinstance(body,str): body=body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        if attachment:self.send_header('Content-Disposition',f'attachment; filename="{attachment}"')
        self.end_headers()
        if self.command!='HEAD': self.wfile.write(body)
    def do_GET(self):
        route=unquote(urlsplit(self.path).path)
        if route=='/api/report':return endpoint.handler.do_GET(self)
        if route=='/api/prime-rate':return self.send(200,json.dumps({'ok':False}),'application/json')
        if route.startswith('/api/'):return self.send(503,'External submissions are disabled in local review.')
        file=(FRONTEND/('index.html' if route in ['/','/index.html'] else route.lstrip('/'))).resolve()
        if FRONTEND not in file.parents:return self.send(403,'Forbidden')
        if not file.is_file():return self.send(404,'Not found')
        return self.send(200,file.read_bytes(),mimetypes.guess_type(file)[0] or 'application/octet-stream')
    do_HEAD=do_GET
    def do_POST(self):
        if urlsplit(self.path).path!='/api/report':return self.send(503,'External submissions are disabled.')
        if self.headers.get('Origin') not in [None,f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}']:return self.send(403,'Forbidden')
        return endpoint.handler.do_POST(self)

if __name__=='__main__':
    if not (FRONTEND/'index.html').is_file():
        raise SystemExit('Run npm run build first, or use npm start.')
    print(f'Peter Calculator is ready at http://127.0.0.1:{PORT}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',PORT),Preview).serve_forever()
