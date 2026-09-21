"""Branded PDF download endpoint for Vercel; no mail or CRM side effects."""
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import json
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from report import render

class handler(BaseHTTPRequestHandler):
    def reply(self,status,body,content_type='text/plain; charset=utf-8',filename=None):
        if isinstance(body,str):body=body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200,json.dumps({'ok':True,'service':'branded-pdf'}),'application/json')

    def do_POST(self):
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=1000000:return self.reply(400,'Invalid report size.')
            payload=json.loads(self.rfile.read(size))
            if not isinstance(payload,dict) or not isinstance(payload.get('inputs'),dict) or not isinstance(payload.get('results'),dict):
                return self.reply(400,'Analyze a deal before downloading.')
            recipient=payload.get('preparedFor')
            if not isinstance(recipient,str) or not recipient.strip() or len(recipient)>120:
                return self.reply(400,'Enter a recipient name (up to 120 characters).')
            # The advisor identity belongs to this edition, not the request body.
            payload['advisor']={'projectName':'Pencil Your Deal','displayName':'Peter Diamond, CBE®'}
            pdf=render(payload)
            name=re.sub(r'[^a-zA-Z0-9 _-]','',recipient).strip().replace(' ','-')[:70] or 'Recipient'
            self.reply(200,pdf,'application/pdf',f'Peter-Calculator-{name}.pdf')
        except (ValueError,TypeError,KeyError,AttributeError,OverflowError):
            self.reply(400,'Invalid deal report. Analyze the deal again and retry.')
        except Exception:
            self.reply(500,'The PDF could not be generated. Please try again.')
