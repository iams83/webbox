import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

page = (Path(__file__).parent / '../node/index.html').resolve().read_bytes()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(page)


server = HTTPServer(('127.0.0.1', int(os.environ['PORT'])), Handler)
print('READY España')
server.serve_forever()
