基线对照树（P2 的父提交 b4cd399c4 = P1-R5 四包电池收口树；P2 相对它只动 12 个文件）
  /tmp/wt-base-dc  datacore A/B 用（node_modules/contracts/llm-adapters dist 按项软链到 complete/）
  /tmp/wt-base-fe  frontend A/B 用（同上）
⚠ 软链安全性依据：P2 对 packages/ 零改动（git diff --stat b4cd399c4 ab3e045a5 -- packages/ 为空）
⚠ 弃用 /tmp/wt-base-front（4a8e02fc6）：该 commit 早于 P2 父提交，缺 1 个测试文件，
  拿它做 A/B 会把「基线里没有这个文件」误读成红。
金丝雀（证明树能真跑测试，不是「能 grep」）：
  wt-base-dc-canary.txt  test/adversary-r6-golden-probe.test.ts  → RC=0（1 passed，负载下 134.67s）
  wt-base-fe-canary.txt  test/debattery.order-chain.test.tsx     → RC=1（用例本身在基线上就红；DOM 真挂载 ⇒ 树是活的）
