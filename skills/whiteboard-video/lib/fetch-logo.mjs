// 真实 Logo：从 Wikimedia Commons 取官方 SVG，Playwright 渲成透明底 PNG → <期>/assets/<name>.png，来源追加到 assets/logos.json。
// 讲公司 / 产品 / 模型时主角用真实 Logo，贴纸（gen-image.mjs）只留给人物和道具。
// 用法：node lib/fetch-logo.mjs <projectDir> name="Commons 文件名.svg 或搜索词" [...] [--vs=a,b] [--search=词]
//   name="OpenAI logo 2025 (symbol).svg"  精确文件（推荐，先 --search 看候选）
//   name="Anthropic logo"                  搜索词：取第一个 .svg 结果
//   --vs=claude,openai                     把两张已有的 logo 拼成 "A VS B" → assets/logos-vs.png（封面主图）
//   --search="OpenAI logo"                 只列 Commons 候选文件，不下载
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import paths from "./paths.cjs";

const UA = "whiteboard-video-skill/1.0 (local video tool)";
const API = "https://commons.wikimedia.org/w/api.php";

/* 向固定Commons接口查询公开素材信息并检查HTTP状态。 */ async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`Commons API ${r.status}`);
  return r.json();
}

/* 检索Commons文件标题，供真实Logo来源选择。 */ async function search(q, limit = 12) {
  const d = await api({ action: "query", list: "search", srnamespace: "6", srlimit: String(limit), srsearch: q });
  return d.query.search.map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (x) => x.title);
}

// 精确文件名直接用；否则搜索，取第一个 .svg
async function resolveTitle(q) {
  if (/\.svg$/i.test(q)) return q.startsWith("File:") ? q : `File:${q}`;
  const hit = (await search(q)).find(/* 查找满足当前身份或边界条件的首个匹配项。 */ (t) => /\.svg$/i.test(t));
  if (!hit) throw new Error(`Commons 上没搜到 "${q}" 的 SVG，先用 --search 看候选`);
  return hit;
}

/* 下载选定SVG并保留源链接，交由禁脚本页面渲染。 */ async function fetchSvg(title) {
  const d = await api({ action: "query", prop: "imageinfo", iiprop: "url", titles: title });
  const page = Object.values(d.query.pages)[0];
  if (!page.imageinfo) throw new Error(`没有这个文件：${title}`);
  const url = page.imageinfo[0].url;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`下载失败 ${r.status} ${url}`);
  return { svg: (await r.text()).replace(/<\?xml[^>]*\?>/, ""), url, page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` };
}

// 按宽高比定渲染框：方形标 800 高，横向字标 1600 宽
function aspectOf(svg) {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (vb) { const [, , w, h] = vb[1].trim().split(/[\s,]+/).map(Number); if (w && h) return w / h; }
  const w = +(svg.match(/\swidth="([\d.]+)/) || [])[1], h = +(svg.match(/\sheight="([\d.]+)/) || [])[1];
  return w && h ? w / h : 1;
}

/* 在隔离页面合成素材并导出透明背景截图。 */ async function shoot(page, html, out) {
  await page.setContent(`<html><body style="margin:0;background:transparent"><div id=w style="display:inline-block;padding:4px">${html}</div><style>svg{width:100%;height:auto;display:block}</style></body></html>`);
  await (await page.$("#w")).screenshot({ path: out, omitBackground: true });
}

const [projectArg, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ (a) => a.startsWith("--")).map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.join("=") || true]; }));
const jobs = rest.filter(/* 筛出满足当前检查条件的项，排除不适用数据。 */ (a) => !a.startsWith("--") && a.includes("=")).map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (a) => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)]; });

if (flags.search) {
  for (const t of await search(flags.search, 20)) console.log(/\.svg$/i.test(t) ? `  ${t}` : `  (非 svg) ${t}`);
  process.exit(0);
}
if (!projectArg || (!jobs.length && !flags.vs)) {
  console.error('用法: wb logo <期> name="Commons 文件名.svg 或搜索词" [...] [--vs=a,b] | wb logo <期> --search="词"');
  process.exit(1);
}

const P = paths.projectPaths(paths.resolveProject(projectArg));
fs.mkdirSync(P.assets, { recursive: true });
const logFile = path.join(P.assets, "logos.json");
const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : {};

const browser = await chromium.launch({executablePath:process.env.WB_CHROMIUM_EXECUTABLE||undefined});
// 网络SVG是不可信输入；禁用脚本并阻断所有外部资源，禁止执行事件处理器或请求内网。
const page = await browser.newPage({javaScriptEnabled:false});
await page.route('**/*', /* 阻断不可信素材渲染时的外部资源请求。 */ route => route.abort());
try {
  for (const [name, q] of jobs) {
    if(!/^[\p{L}\p{N}_-]+$/u.test(name))throw new Error('素材名称只允许文字、数字、下划线和短横线');
    const title = await resolveTitle(q);
    const { svg, url, page: pageUrl } = await fetchSvg(title);
    const asp = aspectOf(svg);
    const box = asp > 1.6 ? `width:1600px` : `width:${Math.round(800 * asp)}px;height:800px`;
    const out = path.join(P.assets, `${name}.png`);
    fs.mkdirSync(P.raw, { recursive: true });
    fs.writeFileSync(path.join(P.raw, `${name}.svg`), svg);   // 原 SVG 留后台 work/raw/
    await shoot(page, `<div style="${box}">${svg}</div>`, out);
    log[name] = { title, page: pageUrl, url, fetched: new Date().toISOString().slice(0, 10) };
    console.log(`  ${name}.png ← ${title}`);
  }
  if (flags.vs) {
    const [a, b] = String(flags.vs).split(",").map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (s) => s.trim());
    const img = /* 从本期已有PNG读取图像，生成内嵌数据资源。 */ (n) => {
      const f = [n, `logo-${n}`].map(/* 映射集合项为当前步骤需要的数据，保留原有顺序。 */ (x) => path.join(P.assets, `${x}.png`)).find(/* 查找满足当前身份或边界条件的首个匹配项。 */ (x) => fs.existsSync(x));
      if (!f) throw new Error(`assets 里没有 ${n}.png / logo-${n}.png，先取 logo`);
      return `<img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}" style="height:520px">`;
    };
    const out = path.join(P.assets, "logos-vs.png");
    await shoot(page, `<div style="display:flex;align-items:center;gap:90px;padding:10px">${img(a)}<div style="font:bold 150px sans-serif;color:#1e1e1e">VS</div>${img(b)}</div>`, out);
    console.log(`  logos-vs.png ← ${a} VS ${b}`);
  }
} finally {
  await browser.close();
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
}
console.log(`来源记在 ${path.relative(P.project, logFile)}，写 README 时抄进「画面素材」`);
