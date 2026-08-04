import { registerDemo } from "../../common/registry.js";

registerDemo({
  name: "excel-exporter",
  label: "excel-exporter — Excel 导出引擎",
  description:
    "用 mock 数据对比 auto / main / worker / stream 四种导出模式的耗时、吞吐、文件体积与阶段拆解。",
  // 实现按需加载：进入该 demo 时才 import 重型代码（excel-exporter、
  // SheetJS/WASM 等），首页只加载这份轻量元信息。
  async load() {
    return import("./basic-export.demo.js");
  },
});
