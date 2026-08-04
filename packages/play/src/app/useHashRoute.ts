import { useEffect, useState } from "react";

/** 解析 hash 路由：`#/` → ""，`#/excel-exporter` → "excel-exporter"。 */
function parseHash(): string {
  return location.hash.startsWith("#/") ? location.hash.slice(2) : "";
}

/**
 * 轻量 hash 路由 hook：刷新不丢当前 demo、URL 可直接分享。
 * 结构只有「概览 / 详情」两层，不需要引入 react-router。
 */
export function useHashRoute(): string {
  const [route, setRoute] = useState<string>(parseHash);

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
