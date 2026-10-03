# 平台「最优化引擎」sidecar：CP-SAT（OR-Tools, Apache-2.0）封装为内部 REST。
# 仅 datacore 经内部网络调用（非公网暴露）；对外只见平台术语求解器键。
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py ./

ENV PORT=4003
EXPOSE 4003
# 健康检查走 /healthz；无业务数据落盘（无状态）。
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4003/healthz').status==200 else 1)"
CMD ["python3", "server.py"]
