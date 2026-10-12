#!/usr/bin/env python3
"""
假 OpenAI-compatible 端点：第 1 轮回一个 bash 工具调用，第 2 轮回一段文本收尾。
目的不是测模型，是测 pi 的 UI —— 工具执行前到底弹不弹审批。
"""
import json, http.server, socketserver, sys, threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
CMD = sys.argv[2] if len(sys.argv) > 2 else "echo TOOL_REALLY_RAN > /tmp/pi-approval-probe.txt; echo done"
turn = {"n": 0}
lock = threading.Lock()


def sse(chunks):
    body = ""
    for c in chunks:
        body += "data: " + json.dumps(c) + "\n\n"
    body += "data: [DONE]\n\n"
    return body.encode()


def frame(delta, finish=None):
    return {"id": "x", "object": "chat.completion.chunk", "created": 0, "model": "fake-1",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.endswith("/models"):
            b = json.dumps({"object": "list", "data": [{"id": "fake-1", "object": "model"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        self.send_error(404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        try:
            req = json.loads(raw)
        except Exception:
            req = {}
        with open("/tmp/fake-llm-requests.jsonl", "a") as f:
            f.write(json.dumps({"tools": [t.get("function", {}).get("name") for t in req.get("tools", [])],
                                "msgs": len(req.get("messages", []))}) + "\n")
        with lock:
            turn["n"] += 1
            t = turn["n"]
        if t == 1:
            chunks = [
                frame({"role": "assistant", "content": "我先跑一条命令确认环境。"}),
                frame({"tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                       "function": {"name": "bash", "arguments": ""}}]}),
                frame({"tool_calls": [{"index": 0, "function": {"arguments": json.dumps({"command": CMD})}}]}),
                frame({}, "tool_calls"),
            ]
        else:
            chunks = [frame({"role": "assistant", "content": "命令已执行完毕，环境正常。"}), frame({}, "stop")]
        body = sse(chunks)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), H) as s:
    print(f"fake-llm on {PORT}", flush=True)
    s.serve_forever()
