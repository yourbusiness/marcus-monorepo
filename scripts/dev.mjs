#!/usr/bin/env node
/**
 * 统一 dev 启动器（替代 turbo run dev）。
 *
 * 背景：Windows 下 turbo -> pnpm.CMD -> cmd.exe -> node 的多层包装会在 Ctrl+C 时
 * 断开信号传递，导致 vite / vitepress / tsup watch 等子进程残留并占用端口。
 *
 * 方案：由本脚本直接以 node 拉起各 dev 进程（不再经过 cmd 包装），收到 SIGINT/SIGTERM
 * 或自身退出时，用 `taskkill /PID <pid> /T /F` 按进程树强杀全部子进程。
 *
 * 用法：
 *   node scripts/dev.mjs            # 启动全部服务
 *   node scripts/dev.mjs play       # 只启动指定服务（excel-exporter / play / docs）
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TASKS = {
  "excel-exporter": {
    cwd: "packages/excel-exporter",
    binPkg: "tsup",
    binName: "tsup",
    args: ["--watch"],
    color: "\x1b[36m", // cyan
  },
  play: {
    cwd: "packages/play",
    binPkg: "vite",
    binName: "vite",
    args: [],
    color: "\x1b[32m", // green
  },
  docs: {
    cwd: "apps/docs",
    binPkg: "vitepress",
    binName: "vitepress",
    args: ["dev", "--port", "5174"],
    color: "\x1b[35m", // magenta
  },
};

/** 从指定工作区的依赖里解析 bin 的 JS 入口文件，避免经过 .CMD 包装 */
function resolveBin(cwd, binPkg, binName) {
  const require2 = createRequire(path.join(root, cwd, "package.json"));
  const pkgJsonPath = require2.resolve(`${binPkg}/package.json`);
  const binField = JSON.parse(readFileSync(pkgJsonPath, "utf8")).bin;
  const rel = typeof binField === "string" ? binField : binField[binName];
  if (!rel) throw new Error(`在 ${binPkg} 中找不到 bin "${binName}"`);
  return path.join(path.dirname(pkgJsonPath), rel);
}

const children = new Set();
let shuttingDown = false;

/** 按进程树终止（Windows 用 taskkill /T，确保孙进程如 esbuild 一并退出） */
function killTree(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* 已退出 */
      }
    }
  } catch {
    /* 进程已不存在 */
  }
}

function killAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child.pid);
  children.clear();
}

function shutdown(code = 0) {
  killAll();
  // 给 taskkill 一点完成时间再退出
  setTimeout(() => process.exit(code), 300).unref();
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => killAll());

/** 行缓冲 + 带颜色前缀的日志输出 */
function pipeWithPrefix(child, tag, color) {
  const reset = "\x1b[0m";
  const prefix = `${color}[${tag}]${reset} `;
  const write = (stream, chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) stream.write(line ? prefix + line + "\n" : "\n");
  };
  child.stdout.on("data", (c) => write(process.stdout, c));
  child.stderr.on("data", (c) => write(process.stderr, c));
}

function spawnTask(key) {
  const task = TASKS[key];
  const bin = resolveBin(task.cwd, task.binPkg, task.binName);
  const child = spawn(process.execPath, [bin, ...task.args], {
    cwd: path.join(root, task.cwd),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  children.add(child);
  pipeWithPrefix(child, key, task.color);

  child.on("error", (err) => {
    console.error(`[${key}] 启动失败: ${err.message}`);
    shutdown(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (shuttingDown) return;
    if (code === 0 || code === null) {
      console.log(`[${key}] 已退出`);
    } else {
      console.error(`[${key}] 异常退出 (code ${code})，正在停止全部服务…`);
      shutdown(code);
    }
    if (children.size === 0) process.exit(0);
  });
  return child;
}

async function main() {
  const selected = process.argv.slice(2);
  const invalid = selected.filter((k) => !(k in TASKS));
  if (invalid.length) {
    console.error(
      `未知服务: ${invalid.join(", ")}。可用: ${Object.keys(TASKS).join(" / ")}`,
    );
    process.exit(1);
  }
  const keys = selected.length ? selected : Object.keys(TASKS);

  // 等价的 turbo dev `dependsOn: ["^build"]`：先构建依赖（turbo 有缓存，很快）
  console.log("\x1b[90m[build]\x1b[0m 先执行依赖构建 turbo run build …");
  const turboBin = resolveBin(".", "turbo", "turbo");
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [turboBin, "run", "build"], {
      cwd: root,
      stdio: "inherit",
    });
    build.on("error", reject);
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`构建失败 (code ${code})`)),
    );
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
  console.log(
    "\x1b[90m[build]\x1b[0m 构建完成，启动 dev 服务（Ctrl+C 停止全部）…\n",
  );

  for (const key of keys) spawnTask(key);
}

main();
