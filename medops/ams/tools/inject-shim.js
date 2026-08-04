#!/usr/bin/env node
/* =====================================================================
 * inject-shim.js — 资产盘点系统原件注入工具
 *
 * 读取 original/ 下的原始单文件 HTML（一个字节不改），定位其中最大的
 * <script> 块（React bundle）：
 *   - bundle 内容原样写入 dist/app.bundle.js
 *   - 原位置替换为 <script src="shim.js?v=<shim内容hash前8位>"></script>
 *   - shim/shim.js 拷入 dist/，写 dist/index.html 与 dist/manifest.json
 *
 * 幂等：每次全量从原件重新生成 dist/，重复执行结果一致（仅 builtAt 变化）。
 * 用法：node tools/inject-shim.js [--src <原件路径>]
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SRC = path.join(ROOT, 'original', 'pandian-v1.10.6.html');
const SHIM_SRC = path.join(ROOT, 'shim', 'shim.js');
const DIST = path.join(ROOT, 'dist');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const srcPath = arg('--src') || DEFAULT_SRC;
const html = fs.readFileSync(srcPath, 'utf8');
const shimJs = fs.readFileSync(SHIM_SRC, 'utf8');

// 顺序扫描全部 <script> 块（不重叠），取内容最大的一个
const blocks = [];
let pos = 0;
for (;;) {
  const s = html.indexOf('<script', pos);
  if (s < 0) break;
  const gt = html.indexOf('>', s);
  const e = html.indexOf('</script>', gt + 1);
  if (gt < 0 || e < 0) break;
  blocks.push({ start: s, contentStart: gt + 1, contentEnd: e, end: e + '</script>'.length });
  pos = e + '</script>'.length;
}
if (!blocks.length) {
  console.error('未找到 <script> 块：' + srcPath);
  process.exit(1);
}
const big = blocks.reduce((a, b) =>
  (b.contentEnd - b.contentStart) > (a.contentEnd - a.contentStart) ? b : a);
const bundle = html.slice(big.contentStart, big.contentEnd);

const bundleSha256 = sha256(bundle);
const shimHash = sha256(shimJs);
const tag = `<script src="shim.js?v=${shimHash.slice(0, 8)}"></script>`;
const outHtml = html.slice(0, big.start) + tag + html.slice(big.end);

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'app.bundle.js'), bundle);
fs.writeFileSync(path.join(DIST, 'index.html'), outHtml);
fs.writeFileSync(path.join(DIST, 'shim.js'), shimJs);
fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify({
  source: path.basename(srcPath),
  bundleSha256,
  shimHash,
  builtAt: new Date().toISOString()
}, null, 2) + '\n');

console.log('原件            :', srcPath, `(${html.length} bytes)`);
console.log('bundle          :', `${bundle.length} bytes @ [${big.contentStart}, ${big.contentEnd})`);
console.log('bundleSha256    :', bundleSha256);
console.log('shimHash        :', shimHash);
console.log('dist/           :', DIST);
console.log('注入完成：index.html + shim.js + app.bundle.js + manifest.json');
