import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { globalSearch, type GlobalSearchHit } from "@/api/endpoints";
import zh from "@/locales/zh";
import styles from "./GlobalSearch.module.css";

/**
 * 治理增量 §3/§5：Shell 顶栏全局搜索框（来源 = 检索 #3 GET /a/v1/objects/search）。
 * 选中即跳对象 360 页（/o/:typeKey/:objectKey）。
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const search = useQuery({
    queryKey: ["a", "global-search", q],
    queryFn: () => globalSearch(q, { limit: 10 }),
    enabled: q.trim().length >= 2,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const select = (hit: GlobalSearchHit) => {
    setOpen(false);
    setQ("");
    navigate(`/o/${encodeURIComponent(hit.typeKey)}/${encodeURIComponent(hit.objectKey)}`);
  };

  const hits = search.data?.items ?? [];

  return (
    <div className={styles.wrap} ref={boxRef}>
      <input
        className={styles.search}
        placeholder={zh.object360?.searchPlaceholder ?? zh.common.search}
        aria-label={zh.common.search}
        data-testid="global-search-input"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && q.trim().length >= 2 && (
        <ul className={styles.results} data-testid="global-search-results">
          {hits.length === 0 && <li className={styles.empty}>{zh.common.none}</li>}
          {hits.map((h) => (
            <li key={`${h.typeKey}/${h.objectKey}`}>
              <button type="button" data-testid={`gs-hit-${h.objectKey}`} onClick={() => select(h)}>
                <span>{h.display}</span>
                <span className={styles.meta}>{h.typeKey} · {h.domainKey}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
