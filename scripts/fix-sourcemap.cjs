#!/usr/bin/env node
/**
 * 修复 HBuilderX / UTS 编译器生成的「重复 sources」sourcemap。
 *
 * 症状：微信开发者工具打开项目时白屏 / 代码依赖分析卡在 loading，
 *   控制台报 `No element indexed by 1`（source-map ArraySet.at）。
 * 原因：个别 .js.map 的 sources 写成 ["api/x.uts","api/x.uts"]，
 *   source-map 库的 ArraySet 会按值去重，只留下索引 0，
 *   但 mappings 里仍存在引用 source index 1 的段，于是 at(1) 越界。
 *
 * 修复：把重复 source 去重，并把 mappings 中指向重复项的 source index
 *   重新映射到保留项（VLQ delta 需同步重算）。重复项的 sourcesContent
 *   内容相同时合并；不同时则改为唯一占位名，避免丢失调试信息。
 *
 * 用法：
 *   node scripts/fix-sourcemap.cjs            # 修复（幂等）
 *   node scripts/fix-sourcemap.cjs --check    # 只检查，不写文件
 *   npm run fix:sourcemap
 *
 * 注意：HBuilderX 每次「运行」都会重新生成 sourcemap，
 *   因此每次编译后若再次白屏，需重新执行本脚本，然后重启微信开发者工具。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'unpackage', 'dist');
const CHECK_ONLY = process.argv.includes('--check');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlq(seg) {
  const out = [];
  let v = 0, shift = 0;
  for (const ch of seg) {
    let d = B64.indexOf(ch);
    if (d < 0) continue;
    const cont = d & 32;
    d &= 31;
    v += d * Math.pow(2, shift);
    if (cont) { shift += 5; }
    else {
      const neg = v & 1;
      let n = Math.floor(v / 2);
      if (neg) n = -n;
      out.push(n);
      v = 0;
      shift = 0;
    }
  }
  return out;
}

function encodeVlq(n) {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let s = '';
  do {
    let d = v & 31;
    v = Math.floor(v / 32);
    if (v > 0) d |= 32;
    s += B64[d];
  } while (v > 0);
  return s;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.map')) out.push(p);
  }
  return out;
}

function findSourcemapDirs() {
  const dirs = [];
  if (!fs.existsSync(DIST)) return dirs;
  for (const e of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const candidate = path.join(DIST, e.name, '.sourcemap', 'mp-weixin');
    if (fs.existsSync(candidate)) dirs.push(candidate);
  }
  return dirs;
}

/** 把重复 source 去重，并重写 mappings 中的 source index。 */
function remapSources(j) {
  const sources = j.sources || [];
  const contents = Array.isArray(j.sourcesContent) ? j.sourcesContent : null;
  const firstByValue = new Map();
  const indexMap = [];
  const keep = [];
  const keepOldIndex = [];
  const conflicts = [];

  sources.forEach((s, i) => {
    if (firstByValue.has(s)) {
      const keepAt = firstByValue.get(s);
      indexMap[i] = keepAt;
      if (contents && contents[i] !== contents[keepOldIndex[keepAt]]) {
        conflicts.push({ index: i, value: s });
      }
    } else {
      const n = keep.length;
      firstByValue.set(s, n);
      indexMap[i] = n;
      keep.push(s);
      keepOldIndex.push(i);
    }
  });

  // 内容不一致时不丢弃信息：给重复项一个唯一名字，mappings 保持不变。
  if (conflicts.length) {
    const fixedSources = sources.slice();
    conflicts.forEach((c, k) => { fixedSources[c.index] = c.value + '?dup=' + (k + 1); });
    return { sourceMap: Object.assign({}, j, { sources: fixedSources }), strategy: 'unique-suffix', keepCount: fixedSources.length };
  }

  let oldRun = 0, newRun = 0;
  const lines = (j.mappings || '').split(';').map(line => line.split(',').map(seg => {
    if (!seg) return seg;
    const a = decodeVlq(seg);
    if (a.length < 4) return seg;
    oldRun += a[1];
    const ns = indexMap[oldRun] !== undefined ? indexMap[oldRun] : 0;
    a[1] = ns - newRun;
    newRun = ns;
    return a.map(encodeVlq).join('');
  }).join(','));

  const out = Object.assign({}, j);
  out.sources = keep;
  out.mappings = lines.join(';');
  if (contents) out.sourcesContent = keepOldIndex.map(i => contents[i] !== undefined ? contents[i] : null);
  return { sourceMap: out, strategy: 'merge', keepCount: keep.length };
}

function maxSourceIndex(j) {
  let run = 0, max = -1;
  for (const line of (j.mappings || '').split(';')) {
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const a = decodeVlq(seg);
      if (a.length >= 4) { run += a[1]; max = Math.max(max, run); }
    }
  }
  return max;
}

function verify(j) {
  const max = maxSourceIndex(j);
  if (max >= (j.sources || []).length) return 'mappings 仍引用越界 source index ' + max;
  // 若本地存在 source-map 包，用真实解析器再验一次
  try {
    const sm = require(path.join(ROOT, 'node_modules', 'source-map'));
    const c = new sm.SourceMapConsumer(j);
    let n = 0;
    c.eachMapping(() => n++);
    return 'ok (' + n + ' mappings)';
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') return 'ok (VLQ only)';
    return '解析失败: ' + e.message;
  }
}

function main() {
  const dirs = findSourcemapDirs();
  if (!dirs.length) {
    console.log('未找到 unpackage/dist/*/.sourcemap/mp-weixin，请先通过 HBuilderX 运行一次小程序。');
    process.exit(1);
  }
  let scanned = 0, broken = 0, fixed = 0;
  const failures = [];
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      scanned++;
      let j;
      try { j = JSON.parse(fs.readFileSync(f, 'utf8')); }
      catch (e) { failures.push(f + ' :: JSON 解析失败: ' + e.message); continue; }
      const sources = j.sources || [];
      if (new Set(sources).size === sources.length) continue;
      broken++;
      const rel = path.relative(ROOT, f);
      if (CHECK_ONLY) { console.log('[broken] ' + rel + ' :: ' + JSON.stringify(sources)); continue; }
      const { sourceMap, strategy, keepCount } = remapSources(j);
      const result = verify(sourceMap);
      if (!result.startsWith('ok')) { failures.push(rel + ' :: 修复后校验未通过: ' + result); continue; }
      fs.writeFileSync(f, JSON.stringify(sourceMap), 'utf8');
      fixed++;
      console.log('[fixed ] ' + rel + ' :: ' + strategy + ', sources ' + sources.length + ' -> ' + keepCount + ', ' + result);
    }
  }
  console.log('');
  console.log('扫描 ' + scanned + ' 个 sourcemap，发现损坏 ' + broken + ' 个' + (CHECK_ONLY ? '（仅检查）' : '，已修复 ' + fixed + ' 个') + '。');
  if (failures.length) { failures.forEach(x => console.error('[error] ' + x)); process.exit(1); }
  if (CHECK_ONLY && broken > 0) process.exit(2);
  if (fixed > 0) console.log('请重启微信开发者工具（或点「编译」）重新加载产物。');
}

main();
