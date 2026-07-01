#!/usr/bin/env bash
# WO-ENTERPRISE-DR-AUDIT（sub-A·灾备/数据备份）· 恢复演练脚本
#
# 把 backup-pg.sh 产出的 <name>-<ts>.sql.gz 导入一个**一次性 scratch pg 容器**（默认），
# 导入后打印若干核对表行数供人核对"导得回"（audit_log / outbox_events）。
# 目的：验证备份文件可真恢复（看得见文件 → 导得回数据·行数与源一致），而非"文档说有备份"。
#
# 用法：
#   bash scripts/restore-pg.sh <dump.sql.gz> [--target scratch|datacore|agentcore]
#     --target scratch    （默认）起一次性 postgres:15 容器·导入·核行数·自动销毁（--rm）
#     --target datacore   恢复到 compose 内 postgres-a（**危险·覆盖生产**·需输入 YES 二次确认）
#     --target agentcore  恢复到 compose 内 postgres-b（同上二次确认）
# 环境变量：
#   COMPOSE("docker compose")  SCRATCH_IMAGE(postgres:15)  SCRATCH_PORT(5433)
#   PGA_SERVICE(postgres-a) PGA_USER(datacore) PGA_DB(datacore)
#   PGB_SERVICE(postgres-b) PGB_USER(agentcore) PGB_DB(agentcore)
set -euo pipefail

DUMP="${1:-}"
[[ -z "$DUMP" ]] && { echo "用法: bash scripts/restore-pg.sh <dump.sql.gz> [--target scratch|datacore|agentcore]" >&2; exit 2; }
[[ -f "$DUMP" ]] || { echo "找不到备份文件: $DUMP" >&2; exit 2; }
shift || true

TARGET="scratch"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

COMPOSE="${COMPOSE:-docker compose}"
SCRATCH_IMAGE="${SCRATCH_IMAGE:-postgres:15}"
SCRATCH_PORT="${SCRATCH_PORT:-5433}"
PGA_SERVICE="${PGA_SERVICE:-postgres-a}"; PGA_USER="${PGA_USER:-datacore}"; PGA_DB="${PGA_DB:-datacore}"
PGB_SERVICE="${PGB_SERVICE:-postgres-b}"; PGB_USER="${PGB_USER:-agentcore}"; PGB_DB="${PGB_DB:-agentcore}"

# 核对表：两库共有的无界增长表（备份/恢复行数应一致）。
COUNT_TABLES=("audit_log" "outbox_events")

count_table() {  # count_table <exec-cmd-prefix...> -- <psql-user> <db> <table>
  local user="$1" db="$2" table="$3"; shift 3
  # $@ 是执行前缀（docker run / compose exec）。表不存在返回 0（诚实：不同库表集不同）。
  "$@" psql -qtAX -U "$user" -d "$db" -c \
    "SELECT count(*) FROM ${table};" 2>/dev/null | tr -d '[:space:]' || echo "n/a"
}

# scratch 容器名设为全局，供 EXIT trap 在函数作用域外也可引用（set -u 下不 unbound）。
SCRATCH_CNAME="dr-restore-scratch-$$"
cleanup_scratch() { docker stop "$SCRATCH_CNAME" >/dev/null 2>&1 || true; }

restore_scratch() {
  # 恢复库名 = 备份文件名首段（datacore-… → datacore）；无匹配退回 restore。
  local base; base="$(basename "$DUMP")"
  local db="${base%%-*}"; [[ -n "$db" && "$db" != "$base" ]] || db="restore"
  echo "· 起一次性 scratch pg 容器（${SCRATCH_IMAGE}·TCP 127.0.0.1:${SCRATCH_PORT}·initdb postgres 用户·库 ${db}）"
  docker run -d --rm --name "$SCRATCH_CNAME" \
    -e POSTGRES_PASSWORD=scratch -e POSTGRES_USER=postgres -e POSTGRES_DB="$db" \
    -p "127.0.0.1:${SCRATCH_PORT}:5432" "$SCRATCH_IMAGE" >/dev/null
  trap cleanup_scratch EXIT

  echo "· 等待 scratch pg 就绪…"
  # initdb 期间 pg_isready 会短暂 accepting 再重启 → 追加真连查询确认稳定就绪（防"shutting down"竞态）。
  for _ in $(seq 1 60); do
    if docker exec "$SCRATCH_CNAME" pg_isready -U postgres >/dev/null 2>&1 \
       && docker exec "$SCRATCH_CNAME" psql -qtAX -U postgres -d "$db" -c 'SELECT 1;' >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  echo "· 导入 ${DUMP} → scratch(${db})"
  gunzip -c "$DUMP" | docker exec -i "$SCRATCH_CNAME" psql -q -v ON_ERROR_STOP=0 -U postgres -d "$db" >/dev/null

  echo ""
  echo "恢复行数核对（scratch·${db} 库）:"
  for tbl in "${COUNT_TABLES[@]}"; do
    local n; n="$(count_table postgres "$db" "$tbl" docker exec -i "$SCRATCH_CNAME")"
    echo "  ${tbl}: ${n}"
  done
  echo ""
  echo "✓ 恢复演练完成（scratch 容器将自动销毁）。请把上表行数与源库比对（backup-pg.sh 前查源库同表 count）。"
}

restore_live() {
  local service="$1" user="$2" db="$3"
  echo "⚠ 目标 = 生产 compose 库「${service}/${db}」——将覆盖现有数据！"
  read -r -p "确认覆盖请输入 YES（其他任意键取消）: " ans
  [[ "$ans" == "YES" ]] || { echo "已取消。"; exit 0; }
  echo "· 导入 ${DUMP} → ${service}/${db}"
  gunzip -c "$DUMP" | $COMPOSE exec -T "$service" psql -q -U "$user" -d "$db" >/dev/null
  echo "恢复行数核对（${service}/${db}）:"
  for tbl in "${COUNT_TABLES[@]}"; do
    local n; n="$(count_table "$user" "$db" "$tbl" $COMPOSE exec -T "$service")"
    echo "  ${tbl}: ${n}"
  done
  echo "✓ 已恢复到 ${service}/${db}。"
}

case "$TARGET" in
  scratch)   restore_scratch ;;
  datacore)  restore_live "$PGA_SERVICE" "$PGA_USER" "$PGA_DB" ;;
  agentcore) restore_live "$PGB_SERVICE" "$PGB_USER" "$PGB_DB" ;;
  *) echo "未知 --target: $TARGET（scratch|datacore|agentcore）" >&2; exit 2 ;;
esac
