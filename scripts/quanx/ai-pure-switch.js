/*
 * 地区节点（纯净）组：按 IP 风险评分自动选节点（Quantumult X）
 *
 * 处理若干个 static 纯净组（默认 日本节点（纯净）/ 美国 / 新加坡 / 韩国 / 欧洲节点（纯净），各含同名地区组的全部节点）：
 *   - 保持组内当前节点，直到它不再合格；不合格时换成该组风险分最低的合格节点。
 *   - 组内没有合格节点时，用风险分 34–50 的「备选」节点；仍没有就不切换，只记录并（定时任务时）通知。
 *   - 评分服务出错或超额时结果为「未知」：不切换，也不当作低风险。
 *   - 不会跨地区切换：选哪个纯净组由用户在 AI 策略中手动决定。
 *
 * 检测步骤：
 *   1. 通过节点请求 chatgpt.com/cdn-cgi/trace，取出口 IP（IPv4 或 IPv6）和地区；地区不受 AI 服务支持的直接淘汰。
 *   2. 把出口 IP 一次批量提交给 proxycheck.io（v2 和 v3 各一次，不经过被测节点）：
 *      - 淘汰：v2 判为代理/VPN；v3 的 proxy/vpn/tor/compromised/scraper/anonymous 任一为真；或 v3 风险分 > 50。
 *      - 合格：v3 风险分 ≤ 阈值（默认 33；纯机房 IP 的基础分即 33）。
 *      - 备选：其余（v3 风险分在阈值与 50 之间）。
 *
 * [task_local]
 * 0 9 * * * https://raw.githubusercontent.com/YatMn/QuanX-Roaming/main/scripts/quanx/ai-pure-switch.js, tag=纯净节点定时检测, img-url=checkmark.shield.fill.system, enabled=true
 * event-interaction https://raw.githubusercontent.com/YatMn/QuanX-Roaming/main/scripts/quanx/ai-pure-switch.js, tag=纯净节点立即检测, img-url=checkmark.shield.system, enabled=true
 *
 * 运行方式：
 *   定时任务：只复查各组当前节点，当前节点不合格才检测该组全部节点；有切换或新出现问题时通知。
 *   按钮（event-interaction）：逐个检测全部节点并弹窗列出结果；在某个纯净组上长按运行时只检测该组。
 *   按钮的脚本地址不要带 # 参数，否则 Quantumult X 会提示内容无效。
 *
 * 可选参数（仅定时任务，写在脚本地址 # 之后，用 & 连接）：
 *   key=<proxycheck.io API key>              运行时保存到本地，之后按钮也会使用；不填时用免费的无 key 额度（每天 100 次）
 *   groups=日本节点（纯净）+美国节点（纯净）  要处理的纯净组，用 + 分隔；不填时用默认五组
 *   max=33                                    v3 风险分合格上限（含）
 *   full=1                                    定时任务也逐个检测全部节点
 *
 * 依赖的 Quantumult X 接口：$task.fetch 的 opts.policy（build 598+），
 * $configuration.sendMessage 的 get_customized_policy / get_policy_state / set_policy_state。
 * set_policy_state 只对 static 组生效，切换时会关闭该组相关的活动连接。
 */

const ARGS = parseArgs(($environment && $environment.sourcePath) || "");
const DEFAULT_GROUPS = ["日本节点（纯净）", "美国节点（纯净）", "新加坡节点（纯净）", "韩国节点（纯净）", "欧洲节点（纯净）"];
const MAX_RISK = Number.isFinite(Number(ARGS.max)) && ARGS.max !== "" ? Number(ARGS.max) : 33;
const FALLBACK_RISK = 50;
// 按钮运行时 $environment.params 是长按的节点或策略名；定时任务没有这个值。
const PRESSED = $environment && typeof $environment.params === "string" && $environment.params ? $environment.params : undefined;
const IS_CRON = !PRESSED;
const FULL = ARGS.full === "1" || !IS_CRON;
// 按钮脚本有运行时限：到点后不再检测新节点，留出时间给评分请求和弹窗。
const DEADLINE = IS_CRON ? Infinity : Date.now() + 15000;
const LISTED = ARGS.groups ? ARGS.groups.split("+").map(name => name.trim()).filter(Boolean) : DEFAULT_GROUPS;
const GROUPS = LISTED.includes(PRESSED) ? [PRESSED] : LISTED;
const CONCURRENCY = 4;
const TIMEOUT = 5000;
const STORE_KEY = "quanx_roaming_ai_pure";
const API_KEY_STORE = "quanx_roaming_proxycheck_key";
const TRACE_URL = "https://chatgpt.com/cdn-cgi/trace";
// 主流 AI 服务不支持或受制裁的出口地区；出口落在这些地区时，无论风险分多低都不合格。
const BLOCKED_LOC = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];
const V3_FLAGS = ["proxy", "vpn", "tor", "compromised", "scraper", "anonymous"];
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const API_KEY = loadApiKey();

console.log(`纯净节点检测开始：${IS_CRON ? "定时" : "按钮"}，长按对象 ${PRESSED || "无"}，proxycheck key ${API_KEY ? "已设置" : "未设置"}`);
main().catch(error => finish(null, `检测中断：${redact(error && error.message ? error.message : String(error))}`));

async function main() {
  const nodesByGroup = await candidatesOf(GROUPS);
  if (!GROUPS.some(name => nodesByGroup[name])) throw new Error(`找不到纯净组：${GROUPS.join("、")}`);
  const state = await send({ action: "get_policy_state" });
  const groups = GROUPS.map(name => ({ name, nodes: nodesByGroup[name], current: selected(state, name), results: [] }));
  const live = groups.filter(group => group.nodes && group.nodes.length);

  // 第一轮：各组当前节点（按钮模式下直接检测全部节点）。
  for (const group of live) {
    const first = FULL ? group.nodes : group.nodes.includes(group.current) ? [group.current] : [];
    group.results = await pool(first, CONCURRENCY, probe);
  }
  await score(live.flatMap(group => group.results));

  // 第二轮：当前节点不合格（且不是评分未知）的组，检测其余节点。
  const rescan = live.filter(group => {
    if (FULL) return false;
    const current = group.results.find(result => result.node === group.current);
    return !current || (current.verdict !== "pass" && current.verdict !== "unknown");
  });
  for (const group of rescan) {
    const rest = await pool(group.nodes.filter(node => node !== group.current), CONCURRENCY, probe);
    group.results = group.results.concat(rest);
  }
  await score(rescan.flatMap(group => group.results));

  const report = { time: Date.now(), max: MAX_RISK, keyed: !!API_KEY, regions: {} };
  for (const group of groups) {
    if (!group.nodes) report.regions[group.name] = { status: "missing", tested: 0 };
    else if (!group.nodes.length) report.regions[group.name] = { status: "empty", tested: 0 };
    else report.regions[group.name] = await settle(group);
  }
  finish(report);
}

async function settle(group) {
  const { name, current, results } = group;
  const failed = results.filter(result => result.verdict !== "pass").map(result => `${result.node}：${result.reason}`);
  const base = { tested: results.length, failed };
  const mine = results.find(result => result.node === current);
  if (mine && mine.verdict === "pass") return Object.assign(base, { status: "kept", node: current, result: mine });
  if (mine && mine.verdict === "unknown") return Object.assign(base, { status: "unknown", node: current, result: mine });

  const pick = verdict => best(results.filter(result => result.verdict === verdict));
  const choice = pick("pass") || pick("fallback");
  if (!choice) return Object.assign(base, { status: "none", node: current });
  if (choice.node === current) return Object.assign(base, { status: "kept", node: current, result: choice });
  await send({ action: "set_policy_state", content: { [name]: choice.node } });
  return Object.assign(base, { status: "switched", from: current, node: choice.node, result: choice });
}

// 风险分最低优先；同分保持订阅中的候选顺序（sort 是稳定排序）。
function best(candidates) {
  return candidates.slice().sort((a, b) => a.risk - b.risk)[0];
}

async function probe(node) {
  const result = { node, verdict: "fail" };
  if (Date.now() > DEADLINE) return fail(result, "未检测（超过按钮运行时限）");
  try {
    const trace = parseTrace((await request({ url: TRACE_URL, opts: { policy: node } })).body);
    if (!trace.ip || !trace.loc) return fail(result, "出口检测无结果");
    result.ip = trace.ip;
    result.loc = trace.loc;
    if (BLOCKED_LOC.includes(trace.loc)) return fail(result, `出口地区 ${trace.loc} 不受 AI 服务支持`);
    result.verdict = "pending";
    return result;
  } catch (error) {
    return fail(result, redact(error && error.message ? error.message : String(error)));
  }
}

// 批量评分：所有待评分节点的出口 IP 去重后，v2、v3 各请求一次。
async function score(results) {
  const pending = results.filter(result => result.verdict === "pending");
  if (!pending.length) return;
  const ips = Array.from(new Set(pending.map(result => result.ip)));
  const [v2, v3] = await Promise.all([lookup("v2", ips), lookup("v3", ips)]);
  pending.forEach(result => classify(result, v2.data[result.ip], v3.data[result.ip], v3.error || v2.error));
}

function classify(result, v2, v3, error) {
  const d = v3 && v3.detections;
  const missing = !d || d.risk === null || d.risk === undefined || String(d.risk).trim() === "";
  if (missing || !Number.isFinite(Number(d.risk))) {
    result.verdict = "unknown";
    result.reason = `评分服务无结果${error ? `（${error}）` : ""}`;
    return;
  }
  result.risk = Number(d.risk);
  result.type = (v3.network && v3.network.type) || (v2 && v2.type) || "";
  const flags = V3_FLAGS.filter(flag => d[flag] === true);
  if (v2 && v2.proxy === "yes") flags.push(`v2:${v2.type || "proxy"}`);
  if (flags.length) return fail(result, `风险 ${result.risk}，标记 ${flags.join("/")}`);
  if (result.risk > FALLBACK_RISK) return fail(result, `风险 ${result.risk} > ${FALLBACK_RISK}`);
  if (result.risk > MAX_RISK) {
    result.verdict = "fallback";
    result.reason = `风险 ${result.risk} > ${MAX_RISK}（备选）`;
    return;
  }
  result.verdict = "pass";
}

async function lookup(version, ips) {
  // v3 的批量地址必须带 ?，否则会被重定向成查询本机 IP。
  const query = version === "v2" ? "?vpn=1&risk=1" : "?";
  const url = `https://proxycheck.io/${version}/${query}${API_KEY ? `${query.length > 1 ? "&" : ""}key=${encodeURIComponent(API_KEY)}` : ""}`;
  try {
    const response = await request({
      url,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `ips=${ips.map(encodeURIComponent).join(",")}`,
    });
    const json = JSON.parse(response.body);
    if (json.status !== "ok" && json.status !== "warning") {
      return { data: {}, error: `${version} ${json.status}${json.message ? `：${json.message}` : ""}` };
    }
    if (json.status === "warning") console.log(`proxycheck ${version} 警告：${json.message || ""}`);
    return { data: json };
  } catch (error) {
    return { data: {}, error: `${version} ${redact(error && error.message ? error.message : String(error))}` };
  }
}

function fail(result, reason) {
  result.verdict = "fail";
  result.reason = reason;
  return result;
}

function request(options) {
  const headers = Object.assign({ "User-Agent": UA }, options.headers || {});
  return $task.fetch(Object.assign({}, options, { headers, timeout: TIMEOUT })).then(
    response => {
      if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
      return response;
    },
    reason => {
      throw new Error((reason && reason.error) || "请求超时");
    }
  );
}

function parseTrace(body) {
  const fields = {};
  String(body || "").split("\n").forEach(line => {
    const index = line.indexOf("=");
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  });
  return { ip: fields.ip, loc: (fields.loc || "").toUpperCase() };
}

// 逐组查询，单个组不存在时只把该组记为缺失，不影响其他组。值为 undefined 表示组不存在。
async function candidatesOf(names) {
  const output = {};
  for (const name of names) {
    try {
      const response = await send({ action: "get_customized_policy", content: name });
      const policy = response.ret && response.ret[name];
      if (policy) output[name] = Array.isArray(policy.candidates) ? policy.candidates : [];
    } catch (error) {
      console.log(`读取策略组「${name}」失败：${error.message}`);
    }
  }
  return output;
}

function selected(state, name) {
  const chain = state.ret && state.ret[name];
  return Array.isArray(chain) ? chain[1] : undefined;
}

async function send(message) {
  const response = await $configuration.sendMessage(message);
  if (response && response.error) throw new Error(`${message.action}：${response.error}`);
  return response || {};
}

async function pool(items, size, worker) {
  const output = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

function parseArgs(sourcePath) {
  const args = {};
  const hash = sourcePath.indexOf("#");
  if (hash === -1) return args;
  sourcePath.slice(hash + 1).split("&").forEach(pair => {
    const index = pair.indexOf("=");
    if (index > 0) args[decodeURIComponent(pair.slice(0, index).trim())] = decodeURIComponent(pair.slice(index + 1).trim());
  });
  return args;
}

// key 写在定时任务地址里时保存到本地，按钮运行时从本地读取。
function loadApiKey() {
  if (ARGS.key) {
    $prefs.setValueForKey(ARGS.key, API_KEY_STORE);
    return ARGS.key;
  }
  return $prefs.valueForKey(API_KEY_STORE) || "";
}

// 错误信息里可能带请求地址，输出前去掉 key。
function redact(text) {
  return API_KEY ? String(text).split(API_KEY).join("<key>") : String(text);
}

function finish(report, error) {
  const previous = load();
  if (report) save(report, previous);
  const lines = error ? [error] : summarize(report);
  console.log(`纯净节点检测\n${lines.join("\n")}`);

  if (IS_CRON) {
    const changes = error ? [error] : notable(report, previous);
    if (changes.length) $notify("纯净节点检测", "", changes.join("\n"));
    $done();
  } else {
    const body = lines.map(line => escapeHtml(line)).join("<br/>");
    $done({
      title: "纯净节点检测",
      htmlMessage: `<p style="text-align: left; font-family: -apple-system; font-size: 14px;">${body}</p>`,
    });
  }
}

function summarize(report) {
  const lines = [];
  if (!report.keyed) lines.push("未设置 proxycheck key，使用无 key 额度");
  Object.keys(report.regions).forEach(region => {
    const item = report.regions[region];
    const r = item.result;
    const detail = r && Number.isFinite(r.risk) ? `（风险 ${r.risk}${r.type ? `，${r.type}` : ""}，${r.loc}）` : "";
    if (item.status === "missing") lines.push(`${region}：配置中没有这个策略组`);
    else if (item.status === "empty") lines.push(`${region}：没有匹配的节点`);
    else if (item.status === "none") lines.push(`${region}：检测 ${item.tested} 个，无合格节点，保持 ${item.node || "当前选择"}`);
    else if (item.status === "unknown") lines.push(`${region}：评分服务无结果，保持 ${item.node}`);
    else if (item.status === "switched") lines.push(`${region}：${item.from || "未选择"} → ${item.node}${detail}${r.verdict === "fallback" ? "（备选）" : ""}`);
    else lines.push(`${region}：保持 ${item.node}${detail}`);
    if (FULL && item.failed && item.failed.length) item.failed.forEach(line => lines.push(`  × ${line}`));
  });
  return lines;
}

// 定时任务只在状态变化时通知：发生切换，或某组新变成「无合格节点 / 评分未知」。
function notable(report, previous) {
  const changes = [];
  const before = (previous && previous.regions) || {};
  Object.keys(report.regions).forEach(region => {
    const item = report.regions[region];
    const was = before[region] && before[region].status;
    if (item.status === "switched") changes.push(`${region}：${item.from || "未选择"} → ${item.node}`);
    if (item.status === "none" && was !== "none") changes.push(`${region}：无合格节点，已保持当前选择`);
    if (item.status === "unknown" && was !== "unknown") changes.push(`${region}：评分服务无结果，已保持当前选择`);
  });
  return changes;
}

function load() {
  try {
    return JSON.parse($prefs.valueForKey(STORE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

// 合并保存：按钮只检测一个组时，不覆盖其他组的上次状态。
function save(report, previous) {
  const compact = { time: report.time, max: report.max, regions: Object.assign({}, previous && previous.regions) };
  Object.keys(report.regions).forEach(region => {
    const item = report.regions[region];
    compact.regions[region] = { status: item.status, node: item.node, risk: item.result && item.result.risk, tested: item.tested };
  });
  $prefs.setValueForKey(JSON.stringify(compact), STORE_KEY);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}
