#!/usr/bin/env node
import { XMLParser } from "fast-xml-parser";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getRoot, getUrlsDir, loadDomains } from "./cli.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "text" });

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Scan/1.0" } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally { clearTimeout(timer); }
}

async function getSitemapUrl(domain) {
  for (const path of ["/sitemap-index.xml", "/sitemap.xml"]) {
    try {
      const body = await fetchWithTimeout(`https://${domain}${path}`);
      if (body.includes("<urlset") || body.includes("<sitemapindex")) return `https://${domain}${path}`;
    } catch { /* ignore */ }
  }
  try {
    const body = await fetchWithTimeout(`https://${domain}/`);
    const m = body.match(/<link\s+rel="sitemap"[^>]+href="([^"]+)"/i);
    if (m) {
      const href = m[1];
      return href.startsWith("http") ? href : `https://${domain}${href}`;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchUrlsFromSitemap(sitemapUrl) {
  const body = await fetchWithTimeout(sitemapUrl, 30000);
  const result = parser.parse(body);

  if (result.sitemapindex) {
    const sitemaps = Array.isArray(result.sitemapindex.sitemap)
      ? result.sitemapindex.sitemap
      : [result.sitemapindex.sitemap];
    const urls = [];
    for (const s of sitemaps) {
      if (s.loc && s.loc !== sitemapUrl) {
        try { urls.push(...await fetchUrlsFromSitemap(s.loc)); }
        catch (e) { console.error(`  [warn] ${s.loc}: ${e.message}`); }
      }
    }
    return urls;
  }

  if (result.urlset?.url) {
    const urls = result.urlset.url;
    if (Array.isArray(urls)) return urls.map(u => u.loc).filter(Boolean);
    return urls.loc ? [urls.loc] : [];
  }

  return extractLocDeep(result.urlset ?? result.sitemapindex ?? result);
}

function extractLocDeep(obj) {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap(extractLocDeep);
  const results = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === "loc" && typeof v === "string") results.push(v);
    else results.push(...extractLocDeep(v));
  }
  return results;
}

function loadUrls(domain) {
  const path = join(getUrlsDir(), `${domain}.json`);
  if (!existsSync(path)) return {};
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

function saveUrls(data, domain) {
  mkdirSync(getUrlsDir(), { recursive: true });
  const path = join(getUrlsDir(), `${domain}.json`);
  writeFileSync(path + ".tmp", JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(path + ".tmp", path);
}

export async function scanDomain(domain) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`扫描: ${domain}`);

  const sitemap = await getSitemapUrl(domain);
  if (!sitemap) { console.log("  [error] 未找到 sitemap"); return; }

  console.log(`  sitemap: ${sitemap}`);
  const urls = await fetchUrlsFromSitemap(sitemap);
  console.log(`  发现 ${urls.length} 个 URL`);

  const existing = loadUrls(domain);
  const existingKeys = new Set(Object.keys(existing));
  const sitemapSet = new Set(urls);

  const newUrls = urls.filter(u => !existingKeys.has(u));
  const removed = [...existingKeys].filter(u => !sitemapSet.has(u));

  if (!newUrls.length && !removed.length) { console.log("  无变化，跳过"); return; }

  if (newUrls.length) {
    console.log(`  新增 ${newUrls.length}:`);
    for (const u of newUrls.slice(0, 5)) console.log(`    ${u}`);
    if (newUrls.length > 5) console.log(`    ...+${newUrls.length - 5}`);
    for (const u of newUrls) existing[u] = [];
  } else {
    console.log("  无新增");
  }

  if (removed.length) {
    console.log(`  消失 ${removed.length}`);
    for (const u of removed) delete existing[u];
  }

  saveUrls(existing, domain);
  console.log(`  已写入 urls/${domain}.json (共 ${Object.keys(existing).length} URLs)`);
}

export async function scanAll() {
  const domains = loadDomains();
  if (!domains.length) { console.log("monitored-domains.json 中无活跃域名"); return; }
  console.log(`扫描 ${domains.length} 个域名`);
  for (const d of domains) await scanDomain(d.domain);
}

// 独立运行入口
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("sitemap-scan.js");
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0]) await scanDomain(args[0]);
  else await scanAll();
}
