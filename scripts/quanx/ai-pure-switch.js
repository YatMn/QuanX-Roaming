/*
 * AI 地区纯净组：低风险节点检测与切换（Quantumult X）
 *
 * 处理若干个 static 地区纯净组（默认 日本纯净 / 美国纯净 / 新加坡纯净 / 韩国纯净 / 欧洲纯净，各含该地区全部节点）：
 *   - 保持组内当前节点，直到它不再是低风险；不合格时换成该组欺诈分最低的合格节点。
 *   - 组内没有合格节点时不切换，只记录并（定时任务时）通知。
 *   - 不会跨地区切换：选哪个地区纯净组由用户在 AI 策略中手动决定。
 *
 * 合格条件（全部满足）：
 *   1. my.ippure.com 返回数字 fraudScore，且 ≤ 阈值（默认 25，即「低风险」）；缺字段视为检测失败。
 *   2. 同一节点请求 chatgpt.com/cdn-cgi/trace，地区不在 AI 不支持名单内；出口 IP 与上一步一致
 *      （两次请求分别走了 IPv4 和 IPv6 时，改为要求国家一致）。
 *
 * [task_local]
 * 0,30 * * * * https://raw.githubusercontent.com/YatMn/QuanX-Roaming/main/scripts/quanx/ai-pure-switch.js, tag=纯净节点定时检测, img-url=checkmark.shield.fill.system, enabled=true
 * event-interaction https://raw.githubusercontent.com/YatMn/QuanX-Roaming/main/scripts/quanx/ai-pure-switch.js#full=1, tag=纯净节点立即检测, img-url=checkmark.shield.system, enabled=true
 *
 * 参数（写在脚本地址 # 之后，用 & 连接）：
 *   groups=日本纯净+美国纯净  要处理的地区纯净组，用 + 分隔；不填时用上面的默认五组
 *   max=25                    欺诈分上限（含）
 *   full=1                    逐个检测全部节点并输出完整结果；不加时只复查当前节点，当前节点不合格才检测该组全部节点
 *
 * 依赖的 Quantumult X 接口：$task.fetch 的 opts.policy（build 598+），
 * $configuration.sendMessage 的 get_customized_policy / get_policy_state / set_policy_state。
 * set_policy_state 只对 static 组生效，切换时会关闭该组相关的活动连接。
 */

const ARGS = parseArgs(($environment && $environment.sourcePath) || "");
const DEFAULT_GROUPS = ["日本纯净", "美国纯净", "新加坡纯净", "韩国纯净", "欧洲纯净"];
const GROUPS = ARGS.groups ? ARGS.groups.split("+").map(name => name.trim()).filter(Boolean) : DEFAULT_GROUPS;
const MAX_SCORE = Number.isFinite(Number(ARGS.max)) ? Number(ARGS.max) : 25;
const FULL = ARGS.full === "1";
const IS_CRON = ["0", "-1"].includes(String($environment && $environment.executeType));
const CONCURRENCY = 4;
const TIMEOUT = 5000;
const STORE_KEY = "quanx_roaming_ai_pure";
const PURITY_URL = "https://my.ippure.com/v1/info";
const TRACE_URL = "https://chatgpt.com/cdn-cgi/trace";
// 主流 AI 服务不支持或受制裁的出口地区；出口落在这些地区时，无论欺诈分多低都不合格。
const BLOCKED_LOC = ["CN", "HK", "MO", "RU", "BY", "IR", "KP", "CU", "SY"];
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

main().catch(error => finish(null, `检测中断：${error && error.message ? error.message : error}`));

async function main() {
  const nodesByRegion = await candidatesOf(GROUPS);
  const regions = GROUPS.filter(name => nodesByRegion[name]);
  if (!regions.length) throw new Error(`找不到地区纯净组：${GROUPS.join("、")}`);
  const state = await send({ action: "get_policy_state" });

  const report = { time: Date.now(), max: MAX_SCORE, full: FULL, regions: {} };
  for (const region of GROUPS) {
    report.regions[region] = nodesByRegion[region]
      ? await settleRegion(region, nodesByRegion[region], selected(state, region))
      : { status: "missing", tested: 0 };
  }
  finish(report);
}

async function settleRegion(region, nodes, current) {
  if (!nodes.length) return { status: "empty", tested: 0 };
  const hasCurrent = nodes.includes(current);
  let results = [];
  if (hasCurrent) {
    const first = await probe(current);
    if (first.ok && !FULL) return { status: "kept", node: current, result: first, tested: 1 };
    results.push(first);
  }
  results = results.concat(await pool(nodes.filter(node => node !== current), CONCURRENCY, probe));

  const passing = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok).map(result => result.node + "：" + result.reason);
  if (!passing.length) return { status: "none", node: current, tested: results.length, failed };

  const keep = passing.find(result => result.node === current);
  if (keep) return { status: "kept", node: current, result: keep, tested: results.length, failed };

  // 欺诈分最低优先；同分保持订阅中的候选顺序（sort 是稳定排序）。
  const best = passing.slice().sort((a, b) => a.score - b.score)[0];
  await send({ action: "set_policy_state", content: { [region]: best.node } });
  return { status: "switched", from: current, node: best.node, result: best, tested: results.length, failed };
}

async function probe(node) {
  const result = { node, ok: false };
  try {
    const info = JSON.parse((await request(PURITY_URL, node)).body);
    if (typeof info.fraudScore !== "number" || !info.ip) return fail(result, "纯净度接口未返回分数");
    result.ip = info.ip;
    result.score = info.fraudScore;
    if (info.fraudScore > MAX_SCORE) return fail(result, `欺诈分 ${info.fraudScore} > ${MAX_SCORE}`);

    const trace = parseTrace((await request(TRACE_URL, node)).body);
    result.loc = trace.loc;
    if (!trace.ip || !trace.loc) return fail(result, "AI 出口检测无结果");
    if (BLOCKED_LOC.includes(trace.loc)) return fail(result, `AI 出口地区 ${trace.loc} 不受支持`);
    // 两个检测域名都同时支持 IPv4/IPv6，同一节点的两次请求可能走不同协议：同协议时要求 IP 一致，跨协议时退而核对国家。
    if (isIPv6(trace.ip) === isIPv6(info.ip)) {
      if (trace.ip !== info.ip) return fail(result, "AI 出口 IP 与纯净度检测 IP 不一致");
    } else {
      if (trace.loc !== String(info.countryCode || "").toUpperCase()) return fail(result, "AI 出口与纯净度检测的协议和国家都不一致");
      result.crossFamily = true;
    }
    result.ok = true;
    return result;
  } catch (error) {
    return fail(result, error && error.message ? error.message : String(error));
  }
}

function fail(result, reason) {
  result.reason = reason;
  return result;
}

function request(url, node) {
  return $task.fetch({ url, headers: { "User-Agent": UA }, opts: { policy: node }, timeout: TIMEOUT }).then(
    response => {
      if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
      return response;
    },
    reason => {
      throw new Error((reason && reason.error) || "请求超时");
    }
  );
}

function isIPv6(ip) {
  return String(ip || "").includes(":");
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

function finish(report, error) {
  const previous = load();
  if (report) save(report);
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
  Object.keys(report.regions).forEach(region => {
    const item = report.regions[region];
    const detail = item.result ? `（欺诈分 ${item.result.score}，${item.result.loc}${item.result.crossFamily ? "，IPv4/IPv6 不同，按国家核对" : ""}）` : "";
    if (item.status === "missing") lines.push(`${region}：配置中没有这个策略组`);
    else if (item.status === "empty") lines.push(`${region}：没有匹配的节点`);
    else if (item.status === "none") lines.push(`${region}：检测 ${item.tested} 个，无低风险节点，保持 ${item.node || "当前选择"}`);
    else if (item.status === "switched") lines.push(`${region}：${item.from || "未选择"} → ${item.node}${detail}`);
    else lines.push(`${region}：保持 ${item.node}${detail}`);
    if (FULL && item.failed && item.failed.length) item.failed.forEach(line => lines.push(`  × ${line}`));
  });
  return lines;
}

// 定时任务只在状态变化时通知：发生切换，或某组新变成「无低风险节点」。
function notable(report, previous) {
  const changes = [];
  const before = (previous && previous.regions) || {};
  Object.keys(report.regions).forEach(region => {
    const item = report.regions[region];
    if (item.status === "switched") changes.push(`${region}：${item.from || "未选择"} → ${item.node}`);
    if (item.status === "none" && !(before[region] && before[region].status === "none")) {
      changes.push(`${region}：无低风险节点，已保持当前选择`);
    }
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

function save(report) {
  const compact = { time: report.time, max: report.max, regions: {} };
  Object.keys(report.regions).forEach(region => {
    const item = report.regions[region];
    compact.regions[region] = { status: item.status, node: item.node, score: item.result && item.result.score, tested: item.tested };
  });
  $prefs.setValueForKey(JSON.stringify(compact), STORE_KEY);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}
