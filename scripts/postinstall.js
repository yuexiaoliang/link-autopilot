#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const lines = [
  "",
  `  ${pkg.name} v${pkg.version} 安装完成`,
  "",
  "  别忘了安装配套 skill：",
  "",
  "    npx skills add yuexiaoliang/link-autopilot",
  "",
];

console.log(lines.join("\n"));
