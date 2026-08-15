import { describe, expect, it } from "vitest";
import { exportExcel } from "../index";
// Node's fetch rejects file://, so sync-init the WASM (see setup.ts).
import "./setup";

describe("exportExcel phase reporting (onPhase)", () => {
  it("reports init -> build in order on the main-thread path", async () => {
    const phases: string[] = [];
    const durations: number[] = [];
    const r = await exportExcel({
      filename: "phases-main",
      download: false,
      mode: "main",
      sheets: [
        {
          name: "S",
          columns: [{ key: "x", header: "X" }],
          data: [{ x: 1 }, { x: 2 }],
        },
      ],
      onPhase: (phase, durationMs) => {
        phases.push(phase);
        durations.push(durationMs);
      },
    });
    expect(r.success).toBe(true);
    expect(r.engine).toBe("modern-xlsx");
    // download: false, so the download phase must not be reported.
    expect(phases).toEqual(["init", "build"]);
    for (const d of durations) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports init -> build on the main-thread stream path", async () => {
    const phases: string[] = [];
    const r = await exportExcel({
      filename: "phases-stream",
      download: false,
      mode: "stream",
      sheets: [
        {
          name: "S",
          columns: [{ key: "id", header: "ID" }],
          data: Array.from({ length: 100 }, (_, i) => ({ id: i })),
        },
      ],
      onPhase: (phase) => {
        phases.push(phase);
      },
    });
    expect(r.success).toBe(true);
    expect(r.mode).toBe("stream");
    expect(phases).toEqual(["init", "build"]);
  });

  it("does not report a download phase in Node even with download left on", async () => {
    // Node has no document, so no download happens and the phase must not be
    // reported (types.ts: "Not reported in Node (no document)"). Default
    // download is true -- do NOT pass download:false here.
    const phases: string[] = [];
    const r = await exportExcel({
      filename: "phases-node-download",
      mode: "main",
      sheets: [
        {
          name: "S",
          columns: [{ key: "x", header: "X" }],
          data: [{ x: 1 }],
        },
      ],
      onPhase: (phase) => {
        phases.push(phase);
      },
    });
    expect(r.success).toBe(true);
    expect(phases).toEqual(["init", "build"]);
  });
});
