基线对照：同一文件 vle-acceptance.test.ts 在 P2 的父提交 b4cd399c4 上的 solo 跑
目的：定性 P2 树该文件的红是负载放大还是 P2 引入
结论：基线树更红（2 failed vs P2 树 1 failed）⇒ 负载放大
条件：与 P2 树那两次跑同时段（共享机 load ~450，另有别的 agent 的 datacore 全包在跑）
