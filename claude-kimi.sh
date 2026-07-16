#!/bin/bash
# Claude CLI 代理到 Kimi 的启动脚本
# 用法: ./claude-kimi.sh [claude-args...]

export KIMI_KEY="sk-ojBlSmGcTw4UWPzkvGKtEP6HoGfGFdwGDxXbhESWz56Mc67e"
export ANTHROPIC_AUTH_TOKEN="$KIMI_KEY"
export ANTHROPIC_BASE_URL="https://api.moonshot.cn/v1"
export ANTHROPIC_MODEL="kimi-k2.6"

# 可选：设置日志级别查看 API 调用详情
# export CLAUDE_DEBUG=1

echo "启动 Claude CLI 代理到 Kimi (k2.6)..."
echo "API Base: $ANTHROPIC_BASE_URL"
echo "Model: $ANTHROPIC_MODEL"
echo ""

claude "$@"
