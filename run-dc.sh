#!/bin/bash
# 临时启服脚本（本单验证用，交付前删）
cd /home/user/complete/.claude/worktrees/agent-a0fa85a76318d1e93
export PORT=4071 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-wo-dim3 SEED_DEMO=1
export CREDENTIAL_KEY=4444444444444444444444444444444444444444444444444444444444444444
exec node apps/datacore/dist/server.js
