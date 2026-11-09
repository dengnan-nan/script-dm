/**
 * 真实剧本解析：兼容「Markdown 角色卡 + 分幕 + 搜证线索」和「人物剧本 + 线索卡编号列表」两类常见写法。
 * 只做规则解析，不联网；解析不到的地方会给 warnings，让中控在预览里看到。
 */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const AVATARS = ["🎭", "🌂", "🔧", "🕵️", "📻", "🌿", "🏀", "🎧", "📷", "🪷", "🗡️", "🍶"];

function themeOf(text) {
  const t = String(text || "");
  if (/校园|学校|教室|同学|青春|毕业|社团|校服|宿舍/.test(t)) return "campus";
  if (/古风|宫|皇帝|娘娘|江湖|侠|王朝|府|宴/.test(t)) return "ancient";
  if (/恐怖|尸|鬼|病院|病房|血|尖叫|灵异|凶宅|失踪/.test(t)) return "horror";
  if (/雨|夜|悬疑|推理|警|案|尸检|画廊|收藏/.test(t)) return "night";
  return "paper";
}

const actNo = (s) => {
  if (/^\d+$/.test(s)) return Number(s);
  let n = 0;
  for (const ch of s) n = n * 10 + (CN_NUM[ch] || 0);
  return n || 0;
};

function normalize(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/^\s*[?？·•\uFFFD]\s+/gm, "· ")          // WPS 导出的项目符号常变成问号/乱码
    .replace(/\*\*/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const stripMarks = (l) => l.replace(/^#{1,6}\s*/, "").replace(/^[·•\-*]\s*/, "").replace(/\*\*/g, "").trim();

/** 角色行：角色 1｜沈知予 / 玩家 A｜苏晚，画廊助理 / 人物2：赵凯 */
function roleHeading(line) {
  const l = stripMarks(line).replace(/^[【\[]\s*/, "").replace(/\s*[】\]]$/, "");
  let m = l.match(/^(角色|人物|玩家|角色卡)\s*([0-9一二三四五六七八九十]+|[A-Z])?\s*[｜|:：、]\s*(.+)$/);
  if (!m) m = l.match(/^(角色|人物|玩家)\s*[0-9]+\s+([\u4e00-\u9fa5]{2,4})$/);
  if (!m) return null;
  let rest = (m[3] || "").trim();
  if (!rest) return null;
  // 排除说明性标题
  if (/^卡|表|列|清单|介绍|说明|总览/.test(rest)) return null;
  const parts = rest.split(/[，,｜|、；;]/).map((x) => x.trim()).filter(Boolean);
  let name = (parts[0] || "").replace(/[（(].*?[）)]/g, "").replace(/^的/, "").trim();
  if (!name || name.length > 8) return null;
  if (/^(独立|发给|对应|以上|如下)/.test(name)) return null;
  return { name, rest, title: parts.slice(1).join("，") };
}

function actHeading(line) {
  const l = stripMarks(line).replace(/^[【\[]\s*/, "").replace(/\s*[】\]]$/, "");
  const m = l.match(/^第\s*([一二三四五六七八九十百0-9]+)\s*幕\s*(?:[：:·｜|\-—]\s*)?(.*)$/);
  if (!m) return null;
  const title = (m[2] || "").trim().replace(/^[：:·｜|\-—]\s*/, "");
  if (/^任务|^结束|^总结|^复盘/.test(title)) return null;
  return { no: actNo(m[1]), title };
}

/** 从【标签】切块 */
function tagBlocks(body) {
  const out = [];
  const re = /【([^】]{1,24})】/g;
  let m;
  const marks = [];
  while ((m = re.exec(body))) marks.push({ tag: m[1], at: m.index, end: re.lastIndex });
  if (!marks.length) return [{ tag: "", text: body.trim() }];
  const head = body.slice(0, marks[0].at).trim();
  if (head) out.push({ tag: "", text: head });
  marks.forEach((k, i) => {
    const next = i + 1 < marks.length ? marks[i + 1].at : body.length;
    out.push({ tag: k.tag, text: body.slice(k.end, next).trim() });
  });
  return out;
}

const numbered = (text) => {
  const items = [];
  text.split("\n").forEach((raw) => {
    const l = stripMarks(raw);
    const m = l.match(/^([0-9]{1,2}|[一二三四五六七八九十]+)\s*[.、．)）]\s*(.+)$/);
    if (m) items.push(m[2].trim());
    else if (l && !items.length) items.push(l);
    else if (l && items.length && !/^[0-9]{1,2}\s*[.、．]/ .test(l)) items[items.length - 1] += " " + l;
  });
  return items.filter(Boolean);
};

function buildDesc(role) {
  const pub = (role.pub || "").replace(/\s+/g, " ").trim();
  const secret = (role.secret || "").replace(/\s+/g, " ").trim();
  const rel = (role.rel || "").replace(/\s+/g, " ").trim();
  const known = (role.known || "").replace(/\s+/g, " ").trim();
  const identity = role.title || (pub.split(/[。；;]/)[0] || "剧本中的人物").slice(0, 60);
  const persona = pub && pub.length > 12 ? pub.slice(0, 160) : (identity + "。" + (role.title ? "" : "性格见角色本。"));
  return [
    "身份：" + identity,
    "性格：" + (persona || "自己把握"),
    "与死者的关系：" + (rel || "剧本没有单独写明，需要你在场上试探（你确实认识死者）"),
    "不愿说的事：" + (secret || known || "你有些事不想让人知道，具体见你的角色本"),
    role.story ? ("你的故事线：" + role.story.replace(/\n+/g, " ")) : "",
    role.timeline ? ("你今晚的时间线：\n" + role.timeline) : ""
  ].filter(Boolean).join("\n");
}

function parseScript(rawText, fileName) {
  const text = normalize(rawText);
  const lines = text.split("\n");
  const warnings = [];

  // ---- 书名
  let name = "";
  const tm = text.match(/《([^》]{2,26})》/);
  if (tm) name = tm[1].trim();
  if (!name) name = (lines.find((l) => l.trim()) || "").replace(/^#+\s*/, "").slice(0, 30);
  if (!name) name = String(fileName || "未命名剧本").replace(/\.(docx|doc|txt|md|json)$/i, "");
  name = name.replace(/完整剧本杀|剧本杀|剧本/gi, "").trim().slice(0, 24) || "导入的剧本";

  // ---- 角色
  const roleStart = [];
  lines.forEach((raw, i) => {
    const h = roleHeading(raw);
    if (h) roleStart.push({ i, ...h });
  });
  const stopRe = /^(线索卡|公共线索|深入线索|搜证|解密|真相|复盘|结局|推理指向|完整时间线|时间线|规则|发放建议)/;
  const roles = [];
  roleStart.slice(0, 8).forEach((st, idx) => {
    const endAt = roleStart[idx + 1] ? roleStart[idx + 1].i : lines.length;
    const block = [];
    for (let i = st.i + 1; i < endAt; i++) {
      const l = stripMarks(lines[i]);
      if (!l) continue;
      if (stopRe.test(l)) break;
      if (actHeading(lines[i])) break;
      block.push(lines[i]);
    }
    const role = { name: st.name, title: st.title, pub: "", secret: "", rel: "", known: "", items: "", story: "", timeline: "", tasks: [], rawBlock: block.join("\n") };
    tagBlocks(block.join("\n")).forEach((b) => {
      const tag = b.tag;
      if (/任务/.test(tag)) role.tasks = numbered(b.text);
      else if (/秘密|隐情|不能说/.test(tag)) role.secret = b.text;
      else if (/物品|随身/.test(tag)) role.items = b.text.replace(/\s+/g, " ");
      else if (/印象|认知|关系|看法/.test(tag)) role.known = b.text;
      else if (/时间线|时间轴|今晚做了|你的行动/.test(tag)) role.timeline = b.text;
      else if (/故事线|单人故事|个人经历|背景故事|身世|前情/.test(tag)) role.story = b.text;
      else if (/公开|外表|人设|简介|身份|背景/.test(tag)) role.pub = (role.pub ? role.pub + " " : "") + b.text;
      else if (tag) role.pub = (role.pub ? role.pub + " " : "") + b.text;
    });
    if (!role.pub) {
      // 没有【】标签：取块里前两段当人设
      const plain = block.map(stripMarks).filter(Boolean);
      role.pub = plain.slice(0, 2).join(" ");
      if (plain.length > 2) role.secret = plain.slice(2).join(" ");
    }
    roles.push({
      id: "r" + (roles.length + 1),
      name: role.name,
      avatar: AVATARS[roles.length % AVATARS.length],
      short: (role.title || (role.pub.split(/[。；;]/)[0] || "")).trim().slice(0, 40),
      desc: buildDesc(role),
      story: role.story || "",
      timeline: role.timeline || "",
      tasks: role.tasks.length ? role.tasks.slice(0, 6) : ["弄清今晚发生了什么", "守住自己的秘密", "找出真凶"]
    });
  });
  if (!roles.length) {
    warnings.push("没识别到角色段落（支持「角色 N｜名字」「玩家 A｜名字」「角色：名字」），已生成 4 个占位角色");
    for (let i = 0; i < 4; i++) roles.push({ id: "r" + (i + 1), name: "角色" + "ABCD"[i], avatar: "🎭", desc: "身份：剧本未提供\n性格：未知\n与死者的关系：未知\n不愿说的事：未知", tasks: [] });
  }
  const headCount = text.match(/人数\s*[：:]\s*[（(]?\s*(\d)/);
  const expectCount = headCount ? Number(headCount[1]) : 0;
  if (expectCount && roles.length < expectCount) warnings.push("剧本写了 " + expectCount + " 人，但只识别到 " + roles.length + " 个角色，建议检查剩下的角色标题写法");
  if (expectCount && roles.length > expectCount) warnings.push("剧本写了 " + expectCount + " 人，却识别到 " + roles.length + " 个角色，多出来的可能是误判，请在中控预览里删掉");

  // ---- 线索收集（带分组：act / public / deep）
  const rawClues = [];
  let zone = "";
  let curAct = -1;
  lines.forEach((raw) => {
    const l = stripMarks(raw);
    if (!l) return;
    if (/^(线索卡|公共线索|第一轮搜证|搜证)/.test(l)) { zone = "public"; return; }
    if (/^(深入线索|第二轮搜证)/.test(l)) { zone = "deep"; return; }
    if (/^(解密|真相|复盘|结局|推理指向|完整时间线|时间线)/.test(l)) { zone = ""; return; }
    const ah = actHeading(raw);
    if (ah) { curAct = ah.no; return; }
    let m = l.match(/^线索\s*([0-9]{1,2})?\s*[：:·]\s*(.*)$/);
    if (m) {
      rawClues.push({ kind: curAct > 0 ? "act" : (zone || "public"), actNo: curAct, title: (m[2] || "").slice(0, 16), content: "", lines: [] });
      return;
    }
    // 「1.标题 正文」只在线索区里认
    if (zone) {
      m = l.match(/^([0-9]{1,2})\s*[.、．)）]\s*([^\s]{2,18})\s*(.*)$/);
      if (m) {
        rawClues.push({ kind: zone, actNo: 0, title: m[2].trim(), content: "", lines: m[3] ? [m[3].trim()] : [] });
        return;
      }
    }
    if (rawClues.length) rawClues[rawClues.length - 1].lines.push(l);
  });
  rawClues.forEach((c) => {
    c.content = [c.content, ...c.lines].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!c.content) c.content = c.title;
  });

  // ---- 分幕
  const acts = [];
  lines.forEach((raw, i) => {
    const ah = actHeading(raw);
    if (!ah) return;
    acts.push({ no: ah.no || acts.length + 1, title: ah.title || "", start: i });
  });
  if (acts.length) {
    acts.forEach((a, idx) => {
      const end = idx + 1 < acts.length ? acts[idx + 1].start : lines.length;
      const body = [];
      for (let i = a.start + 1; i < end; i++) {
        const raw = lines[i];
        const l = stripMarks(raw).replace(/【[^】]{1,24}】/g, "").trim();
        if (!l) continue;
        if (/^(线索\s*[0-9]|线索卡|公共线索|深入线索|解密|真相|复盘|结局|推理指向|完整时间线)/.test(l)) {
          // 最后一幕遇到「复盘/真相/结局」就到此为止，后面的真相内容不要混进玩家读本
          if (idx === acts.length - 1) break;
          continue;
        }
        if (/^(真凶|凶手)\s*(是|为|：|:)/.test(l)) continue;
        body.push(l);
      }
      a.public = body.join("\n").replace(/\n{2,}/g, "\n").trim().slice(0, 1500);
      a.title = a.title || "第" + ["一", "二", "三", "四", "五"][idx] + "幕";
    });
  } else {
    warnings.push("没识别到「第一幕 / 第二幕」，已按「开场 · 公共搜证 · 深入搜证」自动切成 3 幕");
  }

  const finalActs = acts.length
    ? acts.map((a, i) => ({ title: a.title, public: a.public || "（这一幕剧本里没有写公开剧情）", personal: {}, clues: [], _no: a.no }))
    : buildActsFromSections(lines, rawClues);
  if (finalActs.length > 4) finalActs.length = 4;

  // ---- 线索挂到幕
  const byKind = (k) => rawClues.filter((c) => c.kind === k);
  if (acts.length) {
    // 剧本里每幕自带的「线索 N：」按幕号归位，其余（公共/深入/全局）平均分到后面几幕
    rawClues.filter((c) => c.kind === "act").forEach((c) => {
      const t = finalActs.find((a) => a._no === c.actNo) || finalActs[finalActs.length - 1];
      t.clues.push(makeClue(c, t.clues.length));
    });
    const rest = rawClues.filter((c) => c.kind !== "act");
    const startIdx = Math.min(1, finalActs.length - 1);
    rest.forEach((c, i) => {
      const t = finalActs[startIdx + (i % Math.max(1, finalActs.length - startIdx))];
      t.clues.push(makeClue(c, t.clues.length));
    });
  } else {
    byKind("public").forEach((c, i) => finalActs[1].clues.push(makeClue(c, i)));
    byKind("deep").forEach((c, i) => finalActs[2].clues.push(makeClue(c, i)));
    byKind("act").concat(byKind("")).forEach((c, i) => finalActs[0].clues.push(makeClue(c, i)));
    // 兜底：所有线索都没分到组，就平分
    if (!finalActs.some((a) => a.clues.length)) {
      rawClues.forEach((c, i) => finalActs[1 + (i % 2)].clues.push(makeClue(c, finalActs[1 + (i % 2)].clues.length)));
    }
  }
  if (!rawClues.length) warnings.push("没识别到线索（支持「线索 1：标题」或线索区里「1.标题 正文」），本局需要 DM 手动发线索");

  // ---- 每幕每人的个人视角：用他自己的故事线 + 时间线，绝不剧透别人
  const rolePrivate = {};
  roles.forEach((role) => {
    const secret = (role.desc.split("不愿说的事：")[1] || "").split("\n")[0].trim();
    const bits = [];
    if (role.story) bits.push("你的故事线：" + role.story.replace(/\n+/g, " ").slice(0, 400));
    if (role.timeline) bits.push("你今晚的时间线：\n" + role.timeline.split("\n").slice(0, 8).join("\n"));
    if (secret && secret !== "你有些事不想让人知道，具体见你的角色本") bits.push("要守住的秘密：" + secret.slice(0, 160));
    rolePrivate[role.id] = bits.join("\n\n") || "你今晚有自己的目的，别急着把话说满。";
  });
  finalActs.forEach((a) => {
    roles.forEach((r) => {
      a.personal[r.id] = `【这一幕 · ${a.title}】\n${rolePrivate[r.id].slice(0, 900)}\n\n这一幕请按自己的时间线行动：该问的照问，该瞒的先瞒一半，被点到再决定说多少。（这一段只发给你）`;
    });
  });

  // ---- 真凶
  let killerName = null;
  const km = text.match(/(?:真凶|凶手)\s*(?:是|为|：|:)\s*([\u4e00-\u9fa5]{2,6})/);
  if (km) killerName = km[1].trim();
  const killer = roles.find((r) => r.name === killerName);
  if (killer) killer.isKiller = true;
  if (!killerName) warnings.push("没识别到「凶手是XX / 真凶：XX」，结算按“无真凶”处理，建议在剧本里补一句明确写法");
  else if (!killer) warnings.push("真凶是「" + killerName + "」，但不在玩家角色里（本格推理的隐藏凶手），投票无法自动判定，复盘请由中控宣布");

  // ---- 复盘/结局（优先抓「复盘」，抓不到再退到真相/推理指向/结局）
  const revealText = pickSection(lines, [
    /^[一二三四五六七八九十]+、\s*[^。\n]{0,8}复盘/,
    /^(最终复盘|复盘)/,
    /^(故事真相|真相)/,
    /^推理指向/,
    /^结局/
  ]);
  const reveal = revealText || (killer
    ? `真凶：${killer.name}。具体手法和动机剧本没有单独写复盘，请中控结合线索口头还原。`
    : "这份剧本没有单独的复盘段落，请中控结合线索与结局说明还原真相。");

  // ---- 简介
  const introText = collectSection(lines, /^(背景故事|背景|故事背景|开场)/) || (finalActs[0] && finalActs[0].public) || "";
  const theme = themeOf(name + "\n" + text.slice(0, 1500));
  const typeMap = { horror: "恐怖还原", ancient: "古风权谋", campus: "校园情感", night: "悬疑推理", paper: "民国恩怨" };

  return {
    script: {
      id: "imported",
      name,
      type: typeMap[theme] || "推理还原",
      theme,
      intro: introText.replace(/\s+/g, " ").slice(0, 200) || "（导入剧本）",
      roles,
      acts: finalActs.map((a) => ({ title: a.title, public: a.public, personal: a.personal, clues: a.clues })),
      ending: {
        trueEnd: killer ? `你们指认了${killer.name}，他承认了自己的手法。` : "这份剧本的真凶不在玩家之中，复盘时由中控揭晓。",
        falseEnd: "你们指认错了人，真正的答案等复盘时揭晓。"
      },
      reveal,
      hints: buildHints(finalActs, killer),
      autoTiming: { clueDelay: 600, clueGap: 240, actGap: 1800, voteDelay: 600 }
    },
    warnings
  };
}

function makeClue(c, i) {
  return {
    id: "C" + String(i + 1).padStart(2, "0"),
    title: (c.title || "线索" + (i + 1)).slice(0, 18),
    content: c.content || c.title || "（这条线索没有正文）",
    to: "all",
    isPublic: true
  };
}

function buildActsFromSections(lines, clues) {
  const idxOf = (re) => lines.findIndex((l) => re.test(stripMarks(l)));
  const bgAt = idxOf(/^(背景故事|背景|故事背景)/);
  const roleAt = idxOf(/^(人物剧本|角色卡|角色介绍)/);
  const lineAt = idxOf(/^(完整时间线|时间线)/);
  const pubAt = idxOf(/^(线索卡|公共线索)/);
  const deepAt = idxOf(/^(深入线索)/);
  const endAt = idxOf(/^(结局|复盘|真相)/);
  const cut = (a, b) => (a >= 0 && b > a ? lines.slice(a + 1, b) : []);

  const take = (arr) => arr.map(stripMarks).filter((l) => l && !/^[0-9]{1,2}\s*[.、．)]\s*/.test(l)).join("\n").slice(0, 1200);
  const act1 = [take(cut(bgAt, roleAt >= 0 ? roleAt : lineAt >= 0 ? lineAt : pubAt >= 0 ? pubAt : lines.length))].filter(Boolean).join("\n") || "所有人被叫到同一个地方，先各自介绍自己，交换表面的信息。";
  const act2 = "第一轮搜证开始。\n" + (take(cut(lineAt, pubAt >= 0 ? pubAt : deepAt >= 0 ? deepAt : lines.length)).slice(0, 500) || "");
  const act3 = "第二轮搜证，所有证据摊开，开始指认。\n" + (endAt >= 0 ? cut(endAt, lines.length).map(stripMarks).filter(Boolean).slice(0, 6).join("\n") : "");

  return [
    { title: "开场 · 各自的说辞", public: act1.slice(0, 1200), personal: {}, clues: [], _no: 1 },
    { title: "第一轮搜证", public: act2.slice(0, 1200), personal: {}, clues: [], _no: 2 },
    { title: "摊牌与指认", public: act3.slice(0, 1200), personal: {}, clues: [], _no: 3 }
  ];
}

function pickSection(lines, regs) {
  for (const re of regs) {
    const s = collectSection(lines, re);
    if (s) return s;
  }
  return "";
}

function collectSection(lines, re) {
  const at = lines.findIndex((l) => re.test(stripMarks(l)));
  if (at < 0) return "";
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (/^#{1,4}\s/.test(raw)) break;               // 下一个大标题就收手
    const l = stripMarks(raw);
    if (!l) { if (out.length > 3) break; continue; }
    if (/^(附|说明|提示|如果你们|要不要|精简成|适合直接)/.test(l) && out.length > 3) break;
    out.push(l);
    if (out.join("\n").length > 1600) break;
  }
  return out.join("\n");
}

function buildHints(acts, killer) {
  const clueTitles = acts.flatMap((a) => a.clues.map((c) => c.title)).filter(Boolean).slice(0, 6);
  const k = killer ? killer.name : "";
  return {
    1: "轻推：先把每个人今晚的行动时间写下来，看谁的时间对不上。",
    2: "中推：把物证和「谁有机会单独行动」对上号" + (clueTitles.length ? "，重点看「" + clueTitles.slice(0, 3).join("、") + "」" : "") + "。",
    3: "强推：注意谁在反复解释同一件事" + (k ? "，以及谁最希望把话头引到别人身上" : "") + "。"
  };
}

module.exports = { parseScript, roleHeading, actHeading, normalize };
