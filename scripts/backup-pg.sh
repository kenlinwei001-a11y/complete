#!/usr/bin/env bash
# WO-ENTERPRISE-DR-AUDIT（sub-A·灾备/数据备份）· 逻辑备份脚本
#
# 对 docker compose 内两库（datacore / agentcore）各跑一次 pg_dump → gzip 落宿主机
# `<name>-<ts>.sql.gz`。看得见文件、可复核、可 restore-pg.sh 导回。
#
# 诚实边界（R13）：这是**逻辑备份 = 时间点快照**，非连续 PITR。连续时间点恢复需 pg WAL
# 归档（当前 docker-compose.yml 未配）——见 DEPLOY.md §9「PITR 升级路径（诚实标未配）」。
#
# 用法：
#   bash scripts/backup-pg.sh [--out DIR] [--keep N]
#     --out DIR   备份目录（默认 ./backups）
#     --keep N    每库保留最近 N 份，删更旧（默认 0 = 不删）
# 环境变量（覆盖默认 compose 值·脱离 compose 直连时用）：
#   PGA_SERVICE(postgres-a) PGA_USER(datacore) PGA_DB(datacore)
#   PGB_SERVICE(postgres-b) PGB_USER(agentcore) PGB_DB(agentcore)
#   COMPOSE("docker compose")  — 也可设 "docker compose -f xxx.yml"
set -euo pipefail

OUT="./backups"
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

COMPOSE="${COMPOSE:-docker compose}"
PGA_SERVICE="${PGA_SERVICE:-postgres-a}"; PGA_USER="${PGA_USER:-datacore}"; PGA_DB="${PGA_DB:-datacore}"
PGB_SERVICE="${PGB_SERVICE:-postgres-b}"; PGB_USER="${PGB_USER:-agentcore}"; PGB_DB="${PGB_DB:-agentcore}"

mkdir -p "$OUT"
TS="$(date +%Y%m%dT%H%M%S)"

dump_one() {
  local name="$1" service="$2" user="$3" db="$4"
  local file="$OUT/${name}-${TS}.sql.gz"
  echo "· 备份 ${name}（服务 ${service}·库 ${db}）→ ${file}"
  # -T：非 TTY（管道）；pg_dump 纯逻辑导出 → gzip。失败 set -e 中止（不产生半截文件由 mv 保证原子）。
  # --no-owner/--no-privileges：恢复到 scratch（无同名 role）时不因 OWNER/GRANT 报错（可移植恢复）。
  local tmp="${file}.partial"
  if $COMPOSE exec -T "$service" pg_dump -U "$user" --no-owner --no-privileges "$db" | gzip > "$tmp"; then
    mv "$tmp" "$file"
    local sz; sz="$(wc -c < "$file")"
    echo "  ✓ ${file}（${sz} 字节）"
  else
    rm -f "$tmp"
    echo "  ✗ 备份 ${name} 失败" >&2
    return 1
  fi
  # 保留策略：每库保留最近 KEEP 份，删更旧。
  if [[ "$KEEP" -gt 0 ]]; then
    # shellcheck disable=SC2012
    ls -1t "$OUT/${name}-"*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
      echo "  · 保留策略删旧：$old"; rm -f "$old"
    done
  fi
}

dump_one datacore  "$PGA_SERVICE" "$PGA_USER" "$PGA_DB"
dump_one agentcore "$PGB_SERVICE" "$PGB_USER" "$PGB_DB"

echo ""
echo "备份完成 → $OUT"
ls -lh "$OUT"/*"-${TS}.sql.gz"
echo ""
echo "诚实提示：逻辑备份=时间点快照·非连续 PITR。连续恢复需 pg WAL 归档（见 DEPLOY.md §9）。"
