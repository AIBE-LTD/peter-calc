"""Run the local CBE review app: python preview.py (requires reportlab and Pillow)."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json, mimetypes, re
from report import render

ROOT=Path(__file__).parent.resolve()
class Preview(BaseHTTPRequestHandler):
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
        if route=='/api/prime-rate':return self.send(200,json.dumps({'ok':False}),'application/json')
        if route.startswith('/api/'):return self.send(503,'External submissions are disabled in local review.')
        file=(ROOT/'index.html') if route in ['/','/index.html'] else (ROOT/'public'/route.lstrip('/')).resolve()
        if file!=ROOT/'index.html' and ROOT/'public' not in file.parents:return self.send(403,'Forbidden')
        if not file.is_file():return self.send(404,'Not found')
        return self.send(200,file.read_bytes(),mimetypes.guess_type(file)[0] or 'application/octet-stream')
    do_HEAD=do_GET
    def do_POST(self):
        if urlsplit(self.path).path!='/api/report':return self.send(503,'External submissions are disabled.')
        if self.headers.get('Origin') not in [None,'http://127.0.0.1:4175','http://localhost:4175']:return self.send(403,'Forbidden')
        size=int(self.headers.get('Content-Length','0'))
        if size<=0 or size>1000000:return self.send(400,'Invalid report size')
        try:
            data=json.loads(self.rfile.read(size))
            if not str(data.get('preparedFor','')).strip():return self.send(400,'Enter a recipient name.')
            pdf=render(data)
            (ROOT.parent/'peter-calculator-review.pdf').write_bytes(pdf)
            name=re.sub(r'[^a-zA-Z0-9 _-]','',str(data['preparedFor'])).strip().replace(' ','-')[:70] or 'Recipient'
            self.send(200,pdf,'application/pdf',f'Peter-Calculator-{name}.pdf')
        except Exception as err:
            print('PDF generation failed:',repr(err),flush=True)
            self.send(500,'The PDF could not be generated. Please try again.')

if __name__=='__main__':
    print('Peter Calculator is ready at http://127.0.0.1:4175',flush=True)
    ThreadingHTTPServer(('127.0.0.1',4175),Preview).serve_forever()
