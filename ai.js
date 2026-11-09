/**
 * AI 写本适配层：任何 OpenAI 兼容的 /chat/completions 都能接（豆包方舟 / DeepSeek / 智谱 / 本地模型）。
 *
 * 配置优先级：
 *   1) 环境变量 ARK_API_KEY / DEEPSEEK_API_KEY / SCRIPT_DM_AI_KEY + 可选的 SCRIPT_DM_AI_BASE / SCRIPT_DM_AI_MODEL
 *   2) 文件 data/ai.json  →  { "baseUrl": "...", "apiKey": "...", "model": "...", "provider": "ark" }
 *
 * 没配 key 时 generateScriptByAI 直接抛错，调用方会退回模板生成，页面照常能用。
 */
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "data", "ai.json");
const GEN = require("./generate");

const PRESETS = {
  ark: {
    label: "火山方舟（豆包）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2-1-pro"
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash"
  },
  zhipu: {
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5-air"
  }
};

function readJsonFile(p) {
  try {
    const txt = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""); // 记事本存下来会带 BOM
    return JSON.parse(txt);
  } catch (e) { return null; }
}

function loadConfig() {
  const env = process.env;
  const envKey = env.SCRIPT_DM_AI_KEY || env.ARK_API_KEY || env.DEEPSEEK_API_KEY || "";
  if (envKey) {
    const provider = env.ARK_API_KEY ? "ark" : (env.DEEPSEEK_API_KEY ? "deepseek" : "");
    const preset = PRESETS[provider] || { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" };
    return {
      apiKey: envKey,
      baseUrl: env.SCRIPT_DM_AI_BASE || preset.baseUrl,
      model: env.SCRIPT_DM_AI_MODEL || preset.model,
      provider: provider || "custom"
    };
  }
  const file = readJsonFile(CONFIG_PATH);
  if (file && file.apiKey) {
    const preset = PRESETS[file.provider] || {};
    return {
      apiKey: String(file.apiKey).trim(),
      baseUrl: String(file.baseUrl || preset.baseUrl || "").replace(/\/$/, ""),
      model: String(file.model || preset.model || ""),
      provider: file.provider || "custom"
    };
  }
  return null;
}

function status() {
  const cfg = loadConfig();
  if (!cfg || !cfg.baseUrl || !cfg.model) return { enabled: false, provider: null, model: null, label: "模板生成（未接 AI）" };
  return {
    enabled: true,
    provider: cfg.provider,
    model: cfg.model,
    label: "AI 写作：" + (PRESETS[cfg.provider] ? PRESETS[cfg.provider].label : cfg.provider)
  };
}

/* ---------------- 提示词 ---------------- */

function buildPrompt(opts) {
  const style = GEN.GEN_STYLES.find((s) => s.id === opts.style) || GEN.GEN_STYLES[0];
  const count = opts.count;
  const system = [
    "你是一位做了十年的剧本杀作者，擅长写本格推理和人物关系。",
    "你要写一本可以直接开玩的剧本杀，玩家数量固定，结构必须严格符合给定的 JSON schema。",
    "写作要求：",
    "1) 每个人都有秘密、有动机、有和死者的具体往事，不要写空话套话；",
    "2) 凶手只有一个，而且不能让最显眼那个人当；凶手的线索要在别人的视角里留下可追的痕迹；",
    "3) 每幕给每个人的专属视角必须是这个人当时看到/做了什么，不要复述公开剧情；",
    "4) 公开线索要能被推理，私人线索要能制造压力；扶车提示绝对不能说出凶手名字；",
    "5) 全部中文，具体、有画面感，不要出现「undefined」「待定」这类占位词。",
    "只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。"
  ].join("\n");

  const schema = {
    name: "书名（6-12 字）",
    type: "类型，例如 硬核推理 / 古风阵营",
    intro: "一段 60-120 字的引子",
    roles: [{
      id: "r1、r2…",
      name: "角色名",
      avatar: "一个 emoji",
      desc: "四行文本：身份：…\\n性格：…\\n与死者的关系：…\\n不愿说的事：…",
      tasks: ["本幕之外的长期目标，3-4 条"],
      isKiller: "布尔，只有一个人是 true"
    }],
    acts: [{
      title: "这一幕的标题",
      public: "公开剧情 150-250 字：现场、尸体状态、在场人、本幕要大家做什么",
      personal: { "r1": "这个角色这一幕的专属视角 80-150 字", "r2": "…" },
      clues: [{
        id: "C101、C102…",
        title: "线索标题",
        content: "线索正文 40-80 字，给现象和可推理的点",
        to: "all 或 角色id",
        isPublic: "布尔"
      }]
    }],
    ending: { trueEnd: "指认正确时的结局", falseEnd: "指认错误时的结局" },
    reveal: "复盘全文，300 字以上：真凶是谁、动机、他怎么做的、破绽在哪、其他人的秘密清单",
    hints: { "1": "轻推，不点名凶手", "2": "中推", "3": "强推" },
    autoTiming: fallbackTiming()
  };

  const user = [
    `参加人数：${count} 人（roles 数组必须正好 ${count} 个角色，id 依次 r1…r${count}）。`,
    `想要的风格：${style.label}（${style.type}）—— ${style.desc}。整本的氛围、用词、场景都要贴这个风格。`,
    opts.title ? `书名用：${opts.title}。` : "书名你自己取。",
    "分幕：至少 3 幕，最多 4 幕。",
    "线索：每一幕 2 条公开线索（to 用 \"all\"）+ 每个角色最多 1 条私人线索（to 写角色 id，isPublic 为 false）。",
    "每个人每一幕都要在 personal 里有专属视角，不能漏人。",
    "下面是必须遵守的 JSON 结构（示例值只是占位，内容要你自己写）：",
    JSON.stringify(schema, null, 2)
  ].join("\n");

  return { system, user, style };
}

/* ---------------- 归一化：把模型返回的内容整理成平台能吃的剧本 ---------------- */

/** 默认节奏（单位秒，界面按分钟显示）：推幕后 10 分钟发线索、线索间隔 4 分钟、每幕 30 分钟、投票 10 分钟 */
function fallbackTiming() {
  return { clueDelay: 600, clueGap: 240, actGap: 1800, voteDelay: 600 };
}

function normScript(raw, opts) {
  const style = GEN.GEN_STYLES.find((s) => s.id === opts.style) || GEN.GEN_STYLES[0];
  const count = opts.count;
  if (!raw || !Array.isArray(raw.roles) || !Array.isArray(raw.acts)) throw new Error("AI 返回的结构不完整");

  const roles = raw.roles.slice(0, count).map((r, i) => {
    const desc = String(r.desc || "").trim();
    const lines = ["身份：", "性格：", "与死者的关系：", "不愿说的事："];
    const ok = lines.every((l) => desc.includes(l));
    return {
      id: "r" + (i + 1),
      name: String(r.name || "角色" + (i + 1)).trim(),
      avatar: String(r.avatar || "🎭").trim(),
      desc: ok ? desc : desc + "\n（补充说明：这是一位与死者有关联的人。）",
      tasks: (Array.isArray(r.tasks) ? r.tasks : []).map((t) => String(t)).slice(0, 5),
      isKiller: !!r.isKiller
    };
  });
  if (roles.length < count) throw new Error("AI 给的角色数不够（" + roles.length + "/" + count + "）");

  // 恰好一个真凶
  const killers = roles.filter((r) => r.isKiller);
  if (killers.length === 0) roles[1 + Math.floor(Math.random() * (roles.length - 1))].isKiller = true;
  else if (killers.length > 1) killers.slice(1).forEach((r) => { r.isKiller = false; });

  const acts = raw.acts.slice(0, 4).map((a, ai) => {
    const personal = {};
    roles.forEach((r, ri) => {
      const txt = (a.personal && (a.personal[r.id] || a.personal["r" + (ri + 1)])) || "";
      personal[r.id] = String(txt).trim() || `（这一幕你站在人群里，听着别人说话，心里在算一件事。）`;
    });
    const clues = (Array.isArray(a.clues) ? a.clues : []).map((c, ci) => {
      const toRaw = String(c.to || "all");
      const to = roles.some((r) => r.id === toRaw) ? toRaw : "all";
      return {
        id: "C" + (ai + 1) + String(ci + 1).padStart(2, "0"),
        title: String(c.title || "线索 " + (ci + 1)),
        content: String(c.content || "这条线索看不清楚，只知道有人动过手。"),
        to,
        isPublic: to === "all"
      };
    });
    return {
      title: String(a.title || "第 " + (ai + 1) + " 幕"),
      public: String(a.public || "").trim() || "现场安静得反常，没有人愿意先开口。",
      personal,
      clues
    };
  });
  if (acts.length < 2) throw new Error("AI 给的幕数太少");

  const hintsRaw = raw.hints || {};
  const hints = {
    1: String(hintsRaw["1"] || hintsRaw[1] || "").trim() || "轻推：先把每个人今晚的行动时间排出来。",
    2: String(hintsRaw["2"] || hintsRaw[2] || "").trim() || "中推：注意谁在反复解释同一件事。",
    3: String(hintsRaw["3"] || hintsRaw[3] || "").trim() || "强推：把物证的归属对一遍，看谁的东西出现在了不该出现的地方。"
  };
  const killerName = roles.find((r) => r.isKiller).name;
  Object.keys(hints).forEach((k) => {
    if (hints[k].includes(killerName)) hints[k] = hints[k].replace(killerName, "那个人");
  });

  const ending = {
    trueEnd: String((raw.ending || {}).trueEnd || "你们指认了真凶，他沉默了很久，最后承认了。"),
    falseEnd: String((raw.ending || {}).falseEnd || "你们指认错了人，真正的凶手在人群里松了口气。")
  };
  const reveal = Array.isArray(raw.reveal) ? raw.reveal.join("\n") : String(raw.reveal || "");

  return {
    id: "gen-ai-" + Date.now(),
    name: String(raw.name || opts.title || style.label + " · " + count + " 人本").slice(0, 24),
    type: String(raw.type || style.type),
    theme: style.id,
    intro: String(raw.intro || ""),
    roles,
    acts,
    ending,
    reveal: reveal || "（复盘没写出来，用中控台的扶车提示带一下吧。）",
    hints,
    autoTiming: fallbackTiming(),
    ai: true
  };
}

/* ---------------- 真正去调模型 ---------------- */

async function generateScriptByAI(opts) {
  const cfg = loadConfig();
  if (!cfg || !cfg.apiKey) throw new Error("没有配置 AI key（data/ai.json 或环境变量）");

  const { system, user, style } = buildPrompt(opts);
  const url = cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 100000);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.85,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "等模型回复超时（100 秒）" : "连不上模型接口（检查 baseUrl 和网络）：" + url);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) throw new Error("模型接口 " + res.status + "：" + text.slice(0, 180));

  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("模型接口返回的不是 JSON"); }
  const content = (((data.choices || [])[0] || {}).message || {}).content || "";
  if (!content) throw new Error("模型没有返回内容");

  let raw;
  try {
    raw = JSON.parse(content.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim());
  } catch (e) {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("模型返回的内容解析失败");
    raw = JSON.parse(m[0]);
  }
  const script = normScript(raw, { ...opts, style: style.id });
  return { script, usage: data.usage || null, provider: cfg.provider, model: cfg.model };
}

module.exports = { PRESETS, loadConfig, status, generateScriptByAI, normScript };
