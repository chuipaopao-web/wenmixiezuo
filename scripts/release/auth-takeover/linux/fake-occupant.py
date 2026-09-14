#!/usr/bin/env python3
"""隔离假占用服务：记录收到的每个请求，响应体故意不是wenmi-api签名。"""
import http.server, sys

PORT = int(sys.argv[1])
LOG = sys.argv[2]

class Handler(http.server.BaseHTTPRequestHandler):
    def _hit(self):
        with open(LOG, 'a') as f:
            f.write(f'{self.command} {self.path}\n')
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"service":"fake-occupant-not-wenmi"}')
    def do_GET(self): self._hit()
    def do_POST(self): self._hit()
    def do_PUT(self): self._hit()
    def do_DELETE(self): self._hit()
    def log_message(self, *a): pass

http.server.HTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
