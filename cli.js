#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { Command } from "commander";

// ── 项目根目录查找（惰性）──

let _root = null;

export function getRoot() {
  if (_root) return _root;
  if (process.env.BACKLINK_DATA_DIR) {
    const p = process.env.BACKLINK_DATA_DIR;
    if (existsSync(p) && existsSync(join(p, "monitored-domains.json"))) {
      _root = dirname(p);
      return _root;
    }
  }
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".backlink-data"))) {
      _root = dir;
      return _root;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("未找到 .backlink-data/ 目录。请设置 BACKLINK_DATA_DIR 环境变量，或在项目根目录下运行。");
}

export function getDataDir() { return join(getRoot(), ".backlink-data"); }
export function getDomainsFile() { return join(getDataDir(), "monitored-domains.json"); }
export function getUrlsDir() { return join(getDataDir(), "urls"); }

// ── 数据操作 ──

export function loadDomains() {
  const file = getDomainsFile();
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf-8"));
  return (data.domains ?? []).filter(d => d.active !== false);
}

export function saveDomains(domains) {
  const file = getDomainsFile();
  let raw = { domains: [] };
  if (existsSync(file)) raw = JSON.parse(readFileSync(file, "utf-8"));
  raw.domains = domains;
  writeFileSync(file + ".tmp", JSON.stringify(raw, null, 2) + "\n", "utf-8");
  renameSync(file + ".tmp", file);
}

export function loadUrls(domain) {
  const path = join(getUrlsDir(), `${domain}.json`);
  if (!existsSync(path)) {
    console.error(`[error] urls/${domain}.json 不存在`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf-8"));
  if ("urls" in data && Array.isArray(data.urls) && data.urls.length > 0) {
    if (typeof data.urls[0] === "object" && data.urls[0] !== null) {
      return Object.fromEntries(data.urls.map(e => [e.url, e.platforms ?? []]));
    }
    const platforms = data.platforms ?? {};
    return Object.fromEntries(data.urls.map(url => [url, platforms[url] ?? []]));
  }
  return data;
}

export function saveUrls(data, domain) {
  const dir = getUrlsDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${domain}.json`);
  writeFileSync(path + ".tmp", JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(path + ".tmp", path);
}

export function getPlatforms(data) {
  const platforms = new Set();
  for (const v of Object.values(data)) {
    if (Array.isArray(v)) for (const p of v) platforms.add(p);
  }
  return [...platforms].sort();
}

// ── blast-query 命令 ──

export function cmdDomains() {
  const domains = loadDomains();
  if (!domains.length) { console.log("无活跃域名"); return; }
  console.log("## 活跃域名");
  console.log("---");
  for (const d of domains) {
    const domain = d.domain;
    const last = d.last_analyzed_at ?? "从未";
    const interval = d.scan_interval_hours ?? 24;
    const path = join(getUrlsDir(), `${domain}.json`);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      const allPlatforms = getPlatforms(data);
      const total = Object.keys(data).length;
      if (!allPlatforms.length) {
        console.log(`- **${domain}** | URL: ${total} | 已完成: 0 | 待铺: ${total} | 缺铺: 0`);
      } else {
        let done = 0, missing = 0;
        for (const covered of Object.values(data)) {
          const s = new Set(covered);
          if (allPlatforms.every(p => s.has(p))) done++;
          for (const p of allPlatforms) { if (!s.has(p)) missing++; }
        }
        console.log(`- **${domain}** | URL: ${total} | 已完成: ${done} | 待铺: ${total - done} | 缺铺: ${missing}`);
      }
    } else {
      console.log(`- **${domain}** | 未扫描（urls/${domain}.json 不存在）`);
    }
    if (last && last !== "从未") {
      console.log(`  上次扫描: ${last} | 扫描间隔: ${interval}h`);
    } else {
      console.log(`  扫描间隔: ${interval}h`);
    }
    if (d.notes) console.log(`  备注: ${d.notes}`);
  }
}

export function cmdList(domain) {
  const data = loadUrls(domain);
  const platforms = getPlatforms(data);
  if (!platforms.length) {
    console.log(`[info] urls/${domain}.json 中无任何平台覆盖记录`);
    return;
  }
  const missingByPlatform = {};
  for (const [url, covered] of Object.entries(data)) {
    for (const p of platforms) {
      if (!covered.includes(p)) {
        missingByPlatform[p] = missingByPlatform[p] ?? [];
        missingByPlatform[p].push(url);
      }
    }
  }
  const totalMissing = Object.values(missingByPlatform).reduce((s, v) => s + v.length, 0);
  console.log(`域名: ${domain}`);
  console.log(`总 URL 数: ${Object.keys(data).length}`);
  console.log(`已知平台数: ${platforms.length}`);
  console.log(`缺铺组合数: ${totalMissing}`);
  console.log("---");
  console.log("## 缺铺清单（按平台分组）");
  for (const p of Object.keys(missingByPlatform).sort((a, b) => missingByPlatform[b].length - missingByPlatform[a].length)) {
    console.log(`### ${p} (${missingByPlatform[p].length} 个 URL)`);
    for (const u of missingByPlatform[p]) console.log(`  ${u}`);
  }
}

export function cmdSummary(domain) {
  const data = loadUrls(domain);
  const platforms = getPlatforms(data);
  const total = Object.keys(data).length;
  if (!platforms.length) {
    console.log(`域名: ${domain} | ${total} URL | 无平台覆盖记录`);
    return;
  }
  const counts = {};
  for (const covered of Object.values(data)) {
    for (const p of platforms) {
      if (covered.includes(p)) counts[p] = (counts[p] ?? 0) + 1;
    }
  }
  const done = Object.values(data).filter(v => platforms.every(p => v.includes(p))).length;
  console.log(`域名: ${domain}`);
  console.log(`总 URL: ${total} | 全覆盖: ${done} | 未完成: ${total - done}`);
  console.log("---");
  console.log("## 各平台覆盖数");
  for (const p of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) {
    console.log(`${p}: ${counts[p]}/${total}`);
  }
}

export function cmdPlatforms(domain) {
  const data = loadUrls(domain);
  for (const p of getPlatforms(data)) console.log(p);
}

export function cmdDone(domain, platform, urls) {
  const data = loadUrls(domain);
  let updated = 0;
  for (const url of urls) {
    if (url in data) {
      if (!data[url].includes(platform)) { data[url].push(platform); updated++; }
    } else {
      process.stderr.write(`[warn] ${url} 不在 urls/${domain}.json 中\n`);
    }
  }
  if (updated) {
    saveUrls(data, domain);
    console.log(`[done] ${platform}: ${updated} 个 URL 标记完成`);
  } else {
    console.log(`[info] ${platform}: 无新 URL 需要更新`);
  }
}

export function cmdAddDomain(domain, interval = 24, notes) {
  const file = getDomainsFile();
  let raw = { domains: [] };
  if (existsSync(file)) raw = JSON.parse(readFileSync(file, "utf-8"));
  const domains = raw.domains ?? [];
  const idx = domains.findIndex(d => d.domain === domain);
  const entry = { domain, scan_interval_hours: parseInt(interval, 10), active: true, notes };
  if (idx >= 0) domains[idx] = entry;
  else domains.push(entry);
  raw.domains = domains;
  writeFileSync(file + ".tmp", JSON.stringify(raw, null, 2) + "\n", "utf-8");
  renameSync(file + ".tmp", file);
  console.log(`[done] 已添加域名: ${domain}`);
}

export function cmdRmDomain(domain) {
  const file = getDomainsFile();
  if (!existsSync(file)) { console.log(`[warn] 未找到域名: ${domain}`); return; }
  const raw = JSON.parse(readFileSync(file, "utf-8"));
  const domains = raw.domains ?? [];
  const filtered = domains.filter(d => d.domain !== domain);
  if (filtered.length === domains.length) { console.log(`[warn] 未找到域名: ${domain}`); return; }
  raw.domains = filtered;
  writeFileSync(file + ".tmp", JSON.stringify(raw, null, 2) + "\n", "utf-8");
  renameSync(file + ".tmp", file);
  console.log(`[done] 已移除域名: ${domain}`);
}

// ── CLI 入口 ──

const program = new Command();

  program
    .name("link-autopilot")
    .description("全自动外链铺设 CLI 工具")
    .version("1.0.0");

  program
    .command("domains")
    .description("列出活跃域名及缺铺统计")
    .action(cmdDomains);

  program
    .command("scan")
    .argument("[domain]", "指定域名（省略则扫描所有）")
    .description("扫描 sitemap 发现新 URL")
    .action(async (domain) => {
      const { scanAll, scanDomain } = await import("./sitemap-scan.js");
      if (domain) await scanDomain(domain);
      else await scanAll();
    });

  program
    .command("list")
    .argument("<domain>", "目标域名")
    .description("列出缺铺的 (URL, 平台) 组合")
    .action(cmdList);

  program
    .command("summary")
    .argument("<domain>", "目标域名")
    .description("各平台覆盖统计")
    .action(cmdSummary);

  program
    .command("platforms")
    .argument("<domain>", "目标域名")
    .description("列出已知平台 slug")
    .action(cmdPlatforms);

  program
    .command("done")
    .argument("<domain>", "目标域名")
    .argument("<platform>", "平台名")
    .argument("<urls...>", "URL 列表")
    .description("标记 URL 在指定平台上铺设完成")
    .action(cmdDone);

  program
    .command("add-domain")
    .argument("<domain>", "域名")
    .option("-i, --interval <hours>", "扫描间隔（小时）", "24")
    .option("--notes <text>", "备注")
    .description("添加监控域名")
    .action((domain, options) => cmdAddDomain(domain, options.interval, options.notes));

  program
    .command("rm-domain")
    .argument("<domain>", "域名")
    .description("移除监控域名")
    .action(cmdRmDomain);

  program.parse();
