import { beforeEach, describe, expect, it, vi } from "vitest";

// modern-xlsx is fully mocked: the loader under test must be drivable into
// its error state on demand (the real initWasm is idempotent, so a previously
// initialized module can never be made to fail again).
const { initWasmMock } = vi.hoisted(() => ({
  initWasmMock: vi.fn(),
}));

vi.mock("modern-xlsx", () => ({
  initWasm: initWasmMock,
}));

import { WasmLoader } from "../wasm-loader";

function makeLoader(wasmUrl?: string): WasmLoader {
  return new WasmLoader({ wasmUrl, timeoutMs: 50, maxRetries: 2 });
}

describe("WasmLoader error recovery", () => {
  beforeEach(() => {
    initWasmMock.mockReset();
  });

  it("parks in the error state after retries are exhausted and refuses to re-run", async () => {
    initWasmMock.mockRejectedValue(new Error("boom"));
    const loader = makeLoader("bad.wasm");

    await expect(loader.ensureLoaded()).rejects.toThrow(
      /failed after 2 attempts: boom/,
    );
    expect(initWasmMock).toHaveBeenCalledTimes(2);
    expect(loader.isReady).toBe(false);

    // Without a reconfiguration the loader must not silently retry.
    await expect(loader.ensureLoaded()).rejects.toThrow(/previously failed/);
    expect(initWasmMock).toHaveBeenCalledTimes(2);
  });

  it("clears the error state on ANY updateOptions call, so the next load retries", async () => {
    initWasmMock.mockRejectedValue(new Error("network down"));
    const loader = makeLoader("good.wasm");
    await expect(loader.ensureLoaded()).rejects.toThrow(/failed after 2/);

    // Same URL, only a timeout tweak: previously this left the loader stuck
    // in "error" forever despite the error message suggesting a retry.
    loader.updateOptions({ timeoutMs: 60 });
    initWasmMock.mockResolvedValue(undefined);

    await loader.ensureLoaded();
    expect(loader.isReady).toBe(true);
    // Two failed attempts + one successful retry.
    expect(initWasmMock).toHaveBeenCalledTimes(3);
  });

  it("re-initializes from the new URL when wasmUrl changes on a ready loader", async () => {
    initWasmMock.mockResolvedValue(undefined);
    const loader = makeLoader("a.wasm");
    await loader.ensureLoaded();
    expect(loader.isReady).toBe(true);
    expect(initWasmMock).toHaveBeenCalledTimes(1);

    loader.updateOptions({ wasmUrl: "b.wasm" });
    expect(loader.isReady).toBe(false);

    await loader.ensureLoaded();
    expect(loader.isReady).toBe(true);
    expect(initWasmMock).toHaveBeenCalledTimes(2);
    expect(initWasmMock).toHaveBeenLastCalledWith("b.wasm");
  });

  it("keeps a ready loader ready when only timeouts/retries change", async () => {
    initWasmMock.mockResolvedValue(undefined);
    const loader = makeLoader("a.wasm");
    await loader.ensureLoaded();

    loader.updateOptions({ timeoutMs: 5_000, maxRetries: 5 });
    expect(loader.isReady).toBe(true);

    await loader.ensureLoaded();
    expect(initWasmMock).toHaveBeenCalledTimes(1);
  });
});
