import { initWasm } from 'modern-xlsx';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface LoaderOptions {
  /** Self-hosted WASM URL. Strongly recommended in production to avoid CDN drift. */
  wasmUrl?: string | URL;
  /** Self-hosted export.worker.mjs URL, required for worker mode. */
  workerUrl?: string | URL;
  /** Per-attempt load timeout, default 10s. */
  timeoutMs?: number;
  /** Max retries, default 3. */
  maxRetries?: number;
}

class WasmLoader {
  private state: LoadState = 'idle';
  private promise: Promise<void> | null = null;
  private opts: LoaderOptions;

  constructor(opts: LoaderOptions = {}) {
    this.opts = { timeoutMs: 10_000, maxRetries: 3, ...opts };
  }

  get supported(): boolean {
    return typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function';
  }

  get isReady(): boolean {
    return this.state === 'ready';
  }

  getOptions(): Readonly<LoaderOptions> {
    return this.opts;
  }

  async ensureLoaded(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.promise) return this.promise;
    this.promise = this.loadWithRetry();
    try {
      await this.promise;
      this.state = 'ready';
    } catch (e) {
      this.state = 'error';
      this.promise = null;
      throw e;
    }
  }

  private async loadWithRetry(): Promise<void> {
    if (!this.supported) {
      throw new Error('[excel-exporter] WebAssembly not supported in this environment');
    }
    const wasmUrl = this.opts.wasmUrl;
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    const maxRetries = this.opts.maxRetries ?? 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`WASM load timeout (attempt ${attempt})`)), timeoutMs),
      );
      try {
        this.state = 'loading';
        await Promise.race([initWasm(wasmUrl), timeout]);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
        }
      }
    }
    throw new Error(`[excel-exporter] WASM load failed after ${maxRetries} attempts: ${(lastErr as Error).message}`);
  }
}

let defaultLoader: WasmLoader = new WasmLoader();

export function getWasmLoader(): WasmLoader {
  return defaultLoader;
}

/** Inject CDN / self-hosted URLs and timeout config at app entry. */
export function configureWasm(opts: LoaderOptions): void {
  defaultLoader = new WasmLoader(opts);
}
