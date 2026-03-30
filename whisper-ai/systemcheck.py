import http.server
import socketserver
import os

# HuggingFace expects port 7860
PORT = 7860

class HealthCheckHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b"System Check: Online and Running!")
        print(f"Health check received from {self.client_address}")

print(f"Starting System Check Server on port {PORT}...")
try:
    with socketserver.TCPServer(("", PORT), HealthCheckHandler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()
except Exception as e:
    print(f"Failed to start server: {e}")
