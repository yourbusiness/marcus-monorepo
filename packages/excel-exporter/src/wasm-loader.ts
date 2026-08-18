import { initWasm } from "modern-xlsx";

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface LoaderOptions {
  /** Self-hosted WASM URL. Strongly recommended in production to avoid CDN drift. */
  wasmUrl?: string | URL;
  /** Self-hosted export.worker.js URL, required for worker mode. */
  workerUrl?: string | URL;
  /** Per-attempt load timeout, default 10s. */
  timeoutMs?: number;
  /** Max retries, default 3. */
  maxRetries?: number;
}

export class WasmLoader {
  private state: LoadState = "idle";
  private promise: Promise<void> | null = null;
  private opts: LoaderOptions;

  constructor(opts: LoaderOptions = {}) {
    this.opts = { timeoutMs: 10_000, maxRetries: 3, ...opts };
  }

  get supported(): boolean {
    return (
      typeof WebAssembly !== "undefined" &&
      typeof WebAssembly.instantiate === "function"
    );
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  getOptions(): Readonly<LoaderOptions> {
    return this.opts;
  }

  /**
   * Merge new options into the current set. If the WASM URL changes while the
   * loader is already ready (or mid-load), reset so the next ensureLoaded
   * re-initializes from the new URL; otherwise keep the loaded state. This avoids
   * discarding an already-loaded WASM module when only timeouts/retries change.
   * A previous load *error* is always cleared by a reconfiguration, so the next
   * ensureLoaded retries with the new settings instead of throwing forever.
   */
  updateOptions(opts: LoaderOptions): void {
    const urlChanged =
      opts.wasmUrl !== undefined && opts.wasmUrl !== this.opts.wasmUrl;
    this.opts = { ...this.opts, ...opts };
    if ((urlChanged && this.state !== "idle") || this.state === "error") {
      this.state = "idle";
      this.promise = null;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "error") {
      throw new Error(
        "[excel-exporter] WASM load previously failed; call configureWasm() to retry with new settings",
      );
    }
    if (this.promise) return this.promise;
    // Capture the promise locally: updateOptions() may null this.promise while
    // the load is in flight (wasmUrl changed), and this load must not clobber
    // the reset state when it settles -- otherwise a superseded old-URL load
    // would mark the loader ready and the new URL would never take effect.
    const promise = (this.promise = this.loadWithRetry());
    try {
      await promise;
      if (this.promise === promise) this.state = "ready";
    } catch (e) {
      if (this.promise === promise) this.state = "error";
      throw e;
    }
  }

  private async loadWithRetry(): Promise<void> {
    if (!this.supported) {
      throw new Error(
        "[excel-exporter] WebAssembly not supported in this environment",
      );
    }
    const wasmUrl = this.opts.wasmUrl;
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const maxRetries = this.opts.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`WASM load timeout (attempt ${attempt})`)),
          timeoutMs,
        );
      });
      try {
        this.state = "loading";
        await Promise.race([initWasm(wasmUrl), timeout]);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
        }
      } finally {
        // Clear the pending timeout so a late reject never surfaces as an
        // unhandled promise rejection after initWasm already resolved.
        if (timer) clearTimeout(timer);
      }
    }
    throw new Error(
      `[excel-exporter] WASM load failed after ${maxRetries} attempts: ${(lastErr as Error).message}`,
    );
  }
}

const defaultLoader: WasmLoader = new WasmLoader();

export function getWasmLoader(): WasmLoader {
  return defaultLoader;
}

/**
 * Inject CDN / self-hosted URLs and timeout config at app entry. Merges into the
 * existing loader rather than replacing it, so an already-loaded WASM module is
 * kept unless the WASM URL actually changes (in which case the next ensureLoaded
 * re-initializes from the new URL). A previous load error is always cleared, so
 * calling this after a failure makes the next export retry with the new settings.
 */
export function configureWasm(opts: LoaderOptions): void {
  defaultLoader.updateOptions(opts);
}
