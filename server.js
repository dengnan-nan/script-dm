/**
 * 剧本杀线上中控平台 · 服务端
 * 能力：
 *  1) AutoDM 机器人主控 / 人工 DM 介入，可随时切换
 *  2) 剧本分幕推送、线索发放、投票、结局分支、扶车、复盘
 *  3) 玩家线索托盘（服务端保存纸条与摆放坐标，多端同步）
 *  4) 线索互传、房间持久化（data/rooms.json）
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const IMPORTED_FILE = path.join(DATA_DIR, "imported.json");
let importedScripts = [];
try {
  importedScripts = JSON.parse(fs.readFileSync(IMPORTED_FILE, "utf8").replace(/^﻿/, ""));
  if (!Array.isArray(importedScripts)) importedScripts = [];
} catch (e) { importedScripts = []; }
const saveImported = () => { try { fs.writeFileSync(IMPORTED_FILE, JSON.stringify(importedScripts, null, 2)); } catch (e) {} };
const findScript = (id) => importedScripts.find((s) => String(s.id) === String(id)) || scripts.getLibraryScript(String(id));
const PUBLIC_DIR = path.join(ROOT, "public");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

/** 公网通道（localtunnel）：让不在同一个 WiFi 的人也能联机 */
let publicUrl = null;
let ltInstance = null;
let ltStarting = false;

async function ensureTunnel() {
  if (publicUrl) return { url: publicUrl };
  if (ltStarting) return { pending: true };
  ltStarting = true;
  try {
    const localtunnel = require("localtunnel");
    const tunnel = await localtunnel({ port: PORT });
    ltInstance = tunnel;
    publicUrl = tunnel.url;
    tunnel.on("close", () => { publicUrl = null; ltInstance = null; });
    tunnel.on("error", () => { publicUrl = null; ltInstance = null; });
    console.log("[tunnel] 公网地址：", publicUrl);
    return { url: publicUrl };
  } catch (e) {
    return { error: e.message || "公网通道开启失败" };
  } finally {
    ltStarting = false;
  }
}

/** 读 JSON 请求体（带大小上限） */
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("文件太大（上限 " + Math.round(limit / 1024 / 1024) + "MB）")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(new Error("请求格式不是 JSON")); }
    });
    req.on("error", reject);
  });
}

/** 抓网页正文（最多 3 次跳转、2MB 上限） */
function fetchText(url, depth = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error("链接格式不对")); }
    const lib = u.protocol === "https:" ? require("https") : require("http");
    const req = lib.get(u, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,text/plain"
      }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, u).href, depth + 1));
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error("对方网站返回 " + res.statusCode + "，可能需要登录或不允许抓取"));
      }
      let size = 0;
      const chunks = [];
      res.on("data", (c) => {
        size += c.length;
        if (size > 2 * 1024 * 1024) { req.destroy(); reject(new Error("网页太大")); }
        else chunks.push(c);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let charset = "utf-8";
        const head = buf.slice(0, 2048).toString("latin1");
        const cm = head.match(/charset=["']?([a-z0-9_-]+)/i);
        if (cm) charset = cm[1].toLowerCase();
        let text;
        try { text = new TextDecoder(charset).decode(buf); }
        catch (e) { text = buf.toString("utf8"); }
        resolve(htmlToText(text));
      });
      res.on("error", reject);
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("抓取超时")); });
    req.on("error", (e) => reject(new Error("连不上这个链接：" + e.message)));
  });
}

function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** 局域网 IPv4 地址（手机扫码要连它） */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal) {
        out.push({ name, ip: n.address, url: "http://" + n.address + ":" + PORT });
      }
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || "/", "http://127.0.0.1");
  const urlPath = decodeURIComponent(parsed.pathname);

  // 局域网信息：给前端拼扫码地址用
  if (urlPath === "/api/net") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      port: PORT, host: os.hostname(), ips: lanAddresses(), publicUrl
    }));
  }

  // 开启公网通道（跨网络联机）
  if (urlPath === "/api/tunnel") {
    ensureTunnel().then((out) => {
      res.writeHead(out.error ? 500 : 200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out));
    });
    return;
  }

  // 二维码：/api/qr?url=<要编码的地址>&room=CODE
  if (urlPath === "/api/qr") {
    const target = parsed.searchParams.get("url");
    if (!target) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("缺少 url 参数");
    }
    return QRCode.toBuffer(target, { type: "png", width: 560, margin: 1, errorCorrectionLevel: "M" })
      .then((buf) => {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
        res.end(buf);
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("二维码生成失败：" + e.message);
      });
  }

  // 剧本库（内置 + 玩家粘贴/上传后保存的）
  if (urlPath === "/api/library") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    const built = scripts.getLibrary();
    const custom = importedScripts.map((s) => ({
      id: s.id, name: s.name, type: s.type || "自定义", theme: s.theme || "paper",
      intro: s.intro || "", roles: (s.roles || []).length, acts: (s.acts || []).length, custom: true
    }));
    return res.end(JSON.stringify({ scripts: custom.concat(built), styles: scripts.GEN_STYLES }));
  }

  // 读取某个剧本全文（点剧本库里的卡片时用）
  if (urlPath.startsWith("/api/script/")) {
    const id = decodeURIComponent(urlPath.slice("/api/script/".length));
    // 删除：只允许删自己存的本（imp-*），内置本不参与
    if (req.method === "DELETE") {
      const before = importedScripts.length;
      importedScripts = importedScripts.filter((s) => String(s.id) !== id);
      if (importedScripts.length === before) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "只允许删除「我存的」剧本" }));
      }
      saveImported();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true }));
    }
    const sc = findScript(id);
    if (!sc) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "剧本不存在或已被删除" }));
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ script: sc }));
  }

  // 把当前解析好的剧本存进剧本库
  if (urlPath === "/api/saveScript" && req.method === "POST") {    readJson(req, 8 * 1024 * 1024).then((body) => {
      const sc = body && body.script;
      if (!sc || !Array.isArray(sc.roles) || !Array.isArray(sc.acts)) throw new Error("剧本内容不完整");
      if (!sc.name) sc.name = "我的本 " + new Date().toLocaleString();
      sc.id = "imp-" + Date.now().toString(36);
      importedScripts.unshift(sc);
      if (importedScripts.length > 60) importedScripts.length = 60;
      saveImported();
      return { id: sc.id, name: sc.name };
    }).then((out) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out));
    }).catch((e) => {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: e.message || "保存失败" }));
    });
    return;
  }

  // 按「人数 + 风格」自动生成一份完整剧本
  if (urlPath === "/api/generate" && req.method === "POST") {
    readJson(req, 64 * 1024).then(async (body) => {
      const count = Number(body.count);
      if (!count || count < 3 || count > 8) throw new Error("参加人数请填 3 ~ 8 人");
      const useAI = body.mode === "ai" || (body.mode !== "template" && aiConfigEnabled());
      if (useAI) {
        try {
          const out = await ai.generateScriptByAI({ count, style: body.style, title: body.title });
          return { script: out.script, warnings: [], ai: { provider: out.provider, model: out.model } };
        } catch (e) {
          const script = scripts.generateScript({ count, style: body.style, title: body.title });
          return { script, warnings: ["AI 生成失败，已用模板兜底：" + (e.message || "未知错误")], ai: null };
        }
      }
      const script = scripts.generateScript({ count, style: body.style, title: body.title });
      return { script, warnings: [], ai: null };
    }).then((out) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out));
    }).catch((e) => {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: e.message || "生成失败" }));
    });
    return;
  }

  // AI 是否已接入（页面用它决定提示语）
  if (urlPath === "/api/ai" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(ai.status()));
    return;
  }

  // 解析上传的 Word / txt / md（文件夹里的多个文件也可以一起发过来）
  if (urlPath === "/api/parse" && req.method === "POST") {
    readJson(req, 24 * 1024 * 1024).then((body) => {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) throw new Error("没有收到文件");
      const chunks = [];
      const warnings = [];
      let first = "";
      for (const f of files) {
        const name = String(f.name || "file");
        if (!first) first = name;
        const buf = Buffer.from(String(f.data || ""), "base64");
        const ext = path.extname(name).toLowerCase();
        if (ext === ".docx" || ext === ".doc" || ext === ".wps") {
          try { chunks.push(scripts.docxToText(buf)); }
          catch (e) {
            if (e.code === "OLD_DOC" || ext === ".doc" || ext === ".wps") {
              try { chunks.push(scripts.oldDocToText(buf)); }
              catch (e2) { warnings.push(name + "：" + (e2.message || e2)); }
            } else {
              warnings.push(name + "：" + e.message);
            }
          }
        } else {
          const t = scripts.decodeAnyText(buf);
          if (!t.trim()) warnings.push(name + "：读不出文字（可能是图片或二进制文件）");
          else chunks.push(t);
        }
      }
      const merged = chunks.filter(Boolean).join("\n\n");
      if (!merged.trim()) throw new Error("文件里没有可读的文字" + (warnings.length ? "（" + warnings.join("；") + "）" : ""));
      const out = scripts.parseTextToScript(merged, path.basename(first || "导入剧本"));
      out.warnings = warnings.concat(out.warnings || []);
      return out;
    }).then((out) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out));
    }).catch((e) => {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: e.message || "解析失败" }));
    });
    return;
  }

  // 从网页链接导入
  if (urlPath === "/api/import" && req.method === "POST") {
    readJson(req, 256 * 1024).then(async (body) => {
      const url = String(body.url || "").trim();
      if (!/^https?:\/\//.test(url)) throw new Error("请填写以 http:// 或 https:// 开头的链接");
      const text = await fetchText(url);
      return scripts.parseTextToScript(text, url.split("/").pop() || "网络剧本");
    }).then((out) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(out));
    }).catch((e) => {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: e.message || "导入失败" }));
    });
    return;
  }

  const filePath = urlPath === "/"
    ? path.join(PUBLIC_DIR, "index.html")
    : path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    res.end(buf);
  });
});

const io = new Server(server, { cors: { origin: "*" } });

/* ---------------------------------------------------------------- 数据层 */

let rooms = loadRooms();

function loadRooms() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.warn("[warn] 存档读取失败，已重建：", e.message);
  }
  return {};
}

function persist() {
  const clean = {};
  for (const [id, room] of Object.entries(rooms)) {
    const copy = Object.assign({}, room);
    delete copy._timers;      // 定时器不可序列化
    delete copy._autoEnding;
    clean[id] = copy;
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2), "utf8");
  } catch (e) {
    console.warn("[warn] 存档写入失败：", e.message);
  }
}

/** 内置剧本库 + 导入解析（见 scripts.js） */
const scripts = require("./scripts");
const ai = require("./ai");
const aiConfigEnabled = () => ai.status().enabled;
const defaultScript = () => scripts.getLibraryScript(scripts.LIBRARY[0].id);

function newRoom(id) {
  return {
    id,
    createdAt: Date.now(),
    autoMaster: true,
    gameStarted: false,
    currentAct: -1,
    voteOpen: false,
    voteResult: null,
    revealOpen: false,
    players: {},      // name -> { roleId, isDM, plays }
    trays: {},        // name -> [item]
    votes: {},        // name -> roleId
    givenClues: {},   // actIdx -> [clueIdx]，已发放过的线索（中控台用来标记"已发放"）
    notices: [],
    script: defaultScript(),
    dmName: null
  };
}

function getRoom(id) {
  if (!rooms[id]) {
    rooms[id] = newRoom(id);
    persist();
  }
  return rooms[id];
}

function roomCode() {
  return "R" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

/* ---------------------------------------------------------------- 工具 */

function makeItem(kind, title, full, tag, x, y) {
  return {
    uid: "it_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    kind, title, full,
    short: full.length > 120 ? full.slice(0, 120) + "…" : full,
    tag, x, y, createdAt: Date.now()
  };
}

function autoPlace(room, name, item) {
  const n = (room.trays[name] || []).length;
  item.x = 20 + (n % 4) * 232;
  item.y = 20 + Math.floor(n / 4) * 168;
}

function pushTrayItem(room, name, item) {
  room.trays[name] = room.trays[name] || [];
  autoPlace(room, name, item);
  room.trays[name].push(item);
  return item;
}

function addNotice(room, text) {
  room.notices.push({ t: Date.now(), text });
  if (room.notices.length > 60) room.notices.shift();
}

function socketsIn(roomId) {
  const list = [];
  for (const s of io.sockets.sockets.values()) {
    if (s.data && s.data.roomId === roomId) list.push(s);
  }
  return list;
}

function emitToPlayer(roomId, name, event, payload) {
  for (const s of socketsIn(roomId)) {
    if (s.data.name === name) s.emit(event, payload);
  }
}

function broadcast(roomId, event, payload, filter) {
  for (const s of socketsIn(roomId)) {
    if (!filter || filter(s)) s.emit(event, payload);
  }
}

/* ---------------------------------------------------------------- 状态视图 */

/** 给单个客户端生成脱敏后的房间状态（玩家看不到凶手、他人剧本、DM 备注） */
function buildState(roomId, viewerName) {
  const room = rooms[roomId];
  if (!room) return null;
  const me = room.players[viewerName] || {};
  const isDM = !!me.isDM;
  const plays = isDM ? !!me.plays : true;   // 兼职中控也参与游戏

  const players = {};
  for (const [name, p] of Object.entries(room.players)) {
    players[name] = {
      roleId: p.roleId,
      isDM: !!p.isDM,
      plays: p.isDM ? !!p.plays : true,
      online: socketsIn(roomId).some(s => s.data.name === name)
    };
  }

  const state = {
    roomId,
    autoMaster: room.autoMaster,
    gameStarted: room.gameStarted,
    currentAct: room.currentAct,
    actTitle: room.currentAct >= 0 ? room.script.acts[room.currentAct].title : "",
    actCount: room.script.acts.length,
    voteOpen: room.voteOpen,
    voteResult: room.voteResult,
    revealOpen: room.revealOpen,
    notices: room.notices.slice(-15),
    dmName: room.dmName,
    autoTiming: room.script.autoTiming,
    autoNext: (() => {
      if (!room.autoMaster || !room.gameStarted) return null;
      const p = nextPlan(room);
      if (!p) return null;
      return { kind: p.kind, label: p.label, actIdx: p.actIdx == null ? null : p.actIdx, at: p.at, leftMs: Math.max(0, p.at - Date.now()) };
    })(),
    game: {
      name: room.script.name,
      type: room.script.type,
      theme: room.script.theme || "paper",
      intro: room.script.intro,
      roles: room.script.roles.map(r => ({ id: r.id, name: r.name, short: r.short || "", desc: r.desc, avatar: r.avatar })),
      acts: room.script.acts.map(a => ({ title: a.title }))
    },
    players,
    me: { name: viewerName, roleId: me.roleId || null, isDM, plays }
  };

  if (isDM) {
    state.dm = {
      votes: room.votes,
      trays: room.trays,
      killerId: (room.script.roles.find(r => r.isKiller) || {}).id || null,
      reveal: room.script.reveal,
      hints: room.script.hints,
      acts: room.script.acts.map((a, i) => ({ idx: i, title: a.title, public: a.public, clues: a.clues })),
      roles: room.script.roles,
      givenClues: room.givenClues || {}
    };
  }
  if (plays) {
    state.tray = room.trays[viewerName] || [];
    state.myRole = room.script.roles
      .filter(r => r.id === me.roleId)
      .map(r => ({ id: r.id, name: r.name, tasks: r.tasks || [], avatar: r.avatar }))[0] || null;
  }
  return state;
}

function syncRoom(roomId) {
  for (const s of socketsIn(roomId)) {
    s.emit("state", buildState(roomId, s.data.name));
  }
}

/* ---------------------------------------------------------------- 剧本推进 */

function pushAct(roomId, idx, byAuto) {
  const room = rooms[roomId];
  if (!room || idx < 0 || idx >= room.script.acts.length) return;
  room.gameStarted = true;
  room.currentAct = idx;
  room.voteOpen = false;
  const act = room.script.acts[idx];
  addNotice(room, `【第 ${idx + 1} 幕】${act.title}${byAuto ? "（AutoDM）" : ""}`);

  for (const [name, p] of Object.entries(room.players)) {
    if (p.isDM && !p.plays) continue;   // 全职中控不收剧本
    const role = room.script.roles.find(r => r.id === p.roleId);
    const personal = act.personal[p.roleId] || "你环顾四周，暂时没有新的发现。";
    const full = `${act.title}\n\n【公共剧情】\n${act.public}\n\n【你的剧本 · ${role ? role.name : "未选角色"}】\n${personal}`;
    const item = makeItem("script", `第 ${idx + 1} 幕 · ${act.title}`, full, "剧本");
    pushTrayItem(room, name, item);
    emitToPlayer(roomId, name, "notify", {
      kind: "script",
      title: `新一轮开始 · 第 ${idx + 1} 幕`,
      body: full,
      hint: "这一幕的剧本已自动放进托盘，可以拖动整理"
    });
  }
  // 全员广播一句，让不在纸条里的人也能立刻看到「新一轮开始了」
  io.to(roomId).emit("toast", { msg: `第 ${idx + 1} 幕开始了：${act.title}` });
  persist();
  syncRoom(roomId);
}

function giveClue(roomId, actIdx, clueIdx) {
  const room = rooms[roomId];
  const act = room.script.acts[actIdx];
  if (!act) return;
  const clue = act.clues[clueIdx];
  if (!clue) return;
  const targets = clue.to === "all"
    ? Object.entries(room.players).filter(([, p]) => !p.isDM || p.plays).map(([n]) => n)
    : [Object.keys(room.players).find(n => room.players[n].roleId === clue.to)].filter(Boolean);

  const full = `线索 ${clue.id} · ${clue.title}\n\n${clue.content}\n\n类型：${clue.isPublic ? "公开线索（全员可见）" : "搜证线索（个人获取）"}`;
  for (const name of targets) {
    const item = makeItem("clue", clue.title, full, "线索");
    pushTrayItem(room, name, item);
    emitToPlayer(roomId, name, "notify", {
      kind: "clue",
      title: `抽到线索：${clue.title}`,
      body: full,
      hint: "已自动放入线索托盘，可拖到任意位置并放大查看"
    });
  }
  addNotice(room, `【线索】${clue.id} ${clue.title}（${targets.length} 人获得）`);
  // 记录已发放，中控台据此把按钮变成"已发放"
  if (!room.givenClues) room.givenClues = {};
  if (!room.givenClues[actIdx]) room.givenClues[actIdx] = [];
  if (!room.givenClues[actIdx].includes(clueIdx)) room.givenClues[actIdx].push(clueIdx);
  persist();
  syncRoom(roomId);
}

/** 一键发放本幕所有还没发过的线索，返回本次发放条数 */
function giveActClues(roomId, actIdx) {
  const room = rooms[roomId];
  if (!room) return 0;
  const act = room.script.acts[actIdx];
  if (!act) return 0;
  const given = (room.givenClues || {})[String(actIdx)] || [];
  let sent = 0;
  act.clues.forEach((c, j) => {
    if (given.indexOf(j) >= 0) return;
    giveClue(roomId, actIdx, j);
    sent++;
  });
  return sent;
}

function openVote(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.voteOpen = true;
  room.voteResult = null;
  addNotice(room, "【投票】投凶环节开启");
  broadcast(roomId, "notify", {
    kind: "vote",
    title: "投凶环节开始",
    body: "请在下方投票区选择你认定的凶手。投票结束前可以随时修改。",
    hint: "投票入口在页面底部"
  });
  persist();
  syncRoom(roomId);
}

function closeVote(roomId) {
  const room = rooms[roomId];
  if (!room.voteOpen && !room.votes) return;
  room.voteOpen = false;
  const killer = room.script.roles.find(r => r.isKiller) || null;
  const counts = {};
  for (const rid of Object.values(room.votes)) counts[rid] = (counts[rid] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topRoleId = sorted.length ? sorted[0][0] : null;
  const topRole = room.script.roles.find(r => r.id === topRoleId) || null;
  const tie = sorted.length > 1 && sorted[0][1] === sorted[1][1];
  const correct = !!topRole && !!killer && topRole.id === killer.id;

  const detail = sorted.map(([rid, n]) => {
    const r = room.script.roles.find(x => x.id === rid);
    return `${r ? r.name : rid}：${n} 票`;
  }).join("\n") || "无人投票";

  const verdict = (correct && !tie ? room.script.ending.trueEnd : room.script.ending.falseEnd)
    + `\n\n投票分布：\n${detail}${tie ? "\n\n（出现平票，按错判处理）" : ""}`;

  room.voteResult = {
    text: verdict,
    correct: correct && !tie,
    killerId: killer ? killer.id : null,
    killerName: killer ? killer.name : "未设定",
    counts: detail
  };
  room.revealOpen = true;
  addNotice(room, "【结算】投票结果已公布");
  broadcast(roomId, "notify", {
    kind: "result",
    title: correct && !tie ? "真相揭晓 · 投对了" : "真相揭晓 · 投错了",
    body: verdict,
    hint: room.script.name + " · 本局投票结果"
  });
  persist();
  syncRoom(roomId);
}

function sendHint(roomId, level) {
  const room = rooms[roomId];
  const text = room.script.hints[String(level)] || room.script.hints[1];
  addNotice(room, `【扶车 L${level}】`);
  broadcast(roomId, "notify", {
    kind: "hint",
    title: `DM 扶车 · ${["", "轻度", "中度", "强"][level] || "提示"}`,
    body: text,
    hint: "扶车提示不直接给出答案，请结合托盘里的线索"
  });
  persist();
  syncRoom(roomId);
}

function sendReveal(roomId) {
  const room = rooms[roomId];
  room.revealOpen = true;
  addNotice(room, "【复盘】已放出");
  broadcast(roomId, "notify", {
    kind: "reveal",
    title: "全局复盘",
    body: room.script.reveal,
    hint: "本局结束后可随时回看"
  });
  persist();
  syncRoom(roomId);
}

/* ---------------------------------------------------------------- AutoDM */

function clearTimers(room) {
  if (room && room._timers) {
    room._timers.forEach(clearTimeout);
  }
  if (room) {
    room._timers = [];
    room._plan = [];
  }
}

/** 时间轴参数的范围（秒）：防止界面填 0 或负数把节奏打乱 */
// 内部一律存秒；界面按分钟填（0.5 分钟 = 30 秒起）
const TIMING_RANGE = {
  clueDelay: [30, 3600],
  clueGap: [30, 3600],
  actGap: [60, 7200],
  voteDelay: [60, 7200]
};

/** 秒 → 给人看的「N 分钟」 */
function fmtMin(sec) {
  const m = Math.round((Number(sec) / 60) * 10) / 10;
  return m + " 分钟";
}

function normTiming(t) {
  const base = { clueDelay: 600, clueGap: 180, actGap: 1800, voteDelay: 600 };
  const out = {};
  for (const k of Object.keys(TIMING_RANGE)) {
    const [min, max] = TIMING_RANGE[k];
    const v = Number((t || {})[k]);
    out[k] = Math.min(max, Math.max(min, Number.isFinite(v) && v > 0 ? Math.round(v) : base[k]));
  }
  return out;
}

/** 取「下一个自动动作」，给前端做倒计时 */
function nextPlan(room) {
  if (!room || !room._plan) return null;
  let best = null;
  for (const p of room._plan) {
    if (p.done) continue;
    if (!best || p.at < best.at) best = p;
  }
  return best;
}

function scheduleAuto(roomId, fromIdx) {
  const room = rooms[roomId];
  clearTimers(room);
  if (!room || !room.autoMaster || !room.gameStarted) return;
  const t = normTiming(room.script.autoTiming);
  const acts = room.script.acts;
  const base = Date.now();
  let delay = 0;
  const toMs = (sec) => Math.max(0, Math.round(sec * 1000));  // autoTiming 单位为秒

  /** 排一个动作：记进 _plan 供倒计时，同时挂真实 timer */
  const plan = (offsetSec, meta, fn) => {
    const at = base + toMs(offsetSec);
    const entry = Object.assign({ at, done: false }, meta);
    room._plan.push(entry);
    room._timers.push(setTimeout(() => {
      entry.done = true;
      const r = rooms[roomId];
      if (!r || !r.autoMaster) return;
      fn(r);
    }, toMs(offsetSec)));
  };

  acts.forEach((act, i) => {
    if (i >= fromIdx) {
      const dAct = delay;
      plan(dAct, { kind: "act", actIdx: i, label: `推送第 ${i + 1} 幕 · ${act.title}` }, (r) => {
        if (r.currentAct >= i) return;   // 这一幕已经推送过，避免重复
        pushAct(roomId, i, true);
      });

      let dClue = dAct + t.clueDelay;
      act.clues.forEach((c, j) => {
        plan(dClue, { kind: "clue", actIdx: i, label: `发放第 ${i + 1} 幕线索 ${j + 1}/${act.clues.length}` }, (r) => {
          giveClue(roomId, i, j);
        });
        dClue += t.clueGap;
      });
    }
    delay += t.actGap;
  });

  plan(delay + t.voteDelay, { kind: "vote", actIdx: null, label: "开启投凶" }, (r) => openVote(roomId));
  plan(delay + t.voteDelay + 60, { kind: "reveal", actIdx: null, label: "结算并放出复盘" }, (r) => {
    closeVote(roomId);
    sendReveal(roomId);
  });
}

/* ---------------------------------------------------------------- socket */

/** 校验并装载一个剧本（内置库或导入解析结果），同时把本局状态清干净 */
function applyScript(room, script) {
  if (!script || typeof script !== "object") return false;
  if (!Array.isArray(script.roles) || !script.roles.length) return false;
  if (!Array.isArray(script.acts) || !script.acts.length) return false;
  const roles = script.roles.slice(0, 12).map((r, i) => ({
    id: String(r.id || "r" + (i + 1)),
    name: String(r.name || "角色" + (i + 1)).slice(0, 16),
    avatar: r.avatar || "🎭",
    desc: String(r.desc || "").slice(0, 300),
    tasks: Array.isArray(r.tasks) ? r.tasks.slice(0, 6).map(t => String(t).slice(0, 120)) : [],
    isKiller: !!r.isKiller
  }));
  const acts = script.acts.slice(0, 12).map((a, i) => ({
    title: String(a.title || `第 ${i + 1} 幕`).slice(0, 40),
    public: String(a.public || "（这一幕没有公开剧情）").slice(0, 4000),
    personal: a.personal && typeof a.personal === "object" ? a.personal : {},
    clues: (Array.isArray(a.clues) ? a.clues : []).slice(0, 12).map((c, j) => ({
      id: String(c.id || "C" + String(j + 1).padStart(2, "0")),
      title: String(c.title || "线索" + (j + 1)).slice(0, 24),
      content: String(c.content || "").slice(0, 1200),
      to: c.to || "all",
      isPublic: c.to === "all" || c.to === undefined
    }))
  }));
  const hints = script.hints && typeof script.hints === "object" ? script.hints : {};
  room.script = {
    id: script.id || "custom",
    name: String(script.name || "导入剧本").slice(0, 30),
    type: String(script.type || "自定义").slice(0, 20),
    theme: ["paper", "night", "ancient", "campus", "horror"].includes(script.theme) ? script.theme : scripts.themeOf(script.name + (acts[0] ? acts[0].public : "")),
    intro: String(script.intro || "").slice(0, 300),
    roles, acts,
    ending: {
      trueEnd: String((script.ending && script.ending.trueEnd) || "真凶已揭晓。").slice(0, 800),
      falseEnd: String((script.ending && script.ending.falseEnd) || "真相被掩盖了。").slice(0, 800)
    },
    reveal: String(script.reveal || "（本剧本没有提供复盘文本）").slice(0, 4000),
    hints: {
      1: String(hints[1] || hints["1"] || "轻推：先列出每个人的动机与在场时间。"),
      2: String(hints[2] || hints["2"] || "中推：把时间、物品、单独行动的机会三者的交集找出来。"),
      3: String(hints[3] || hints["3"] || "强推：注意谁在回避某一件具体的东西。")
    },
    autoTiming: normTiming(script.autoTiming)
  };
  // 换本后本局进度全部归零
  room.gameStarted = false;
  room.currentAct = -1;
  room.voteOpen = false;
  room.voteResult = null;
  room.revealOpen = false;
  room.votes = {};
  room.givenClues = {};
  room.players = {};
  room.trays = {};
  room.notices = [];
  clearTimers(room);
  return true;
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, script, scriptId }) => {
    const id = roomCode();
    const room = getRoom(id);
    room.dmName = name || "DM";
    const target = script || (scriptId ? findScript(scriptId) : null);
    if (target) applyScript(room, target);
    socket.emit("created", { roomId: id });
    persist();
  });

  // 中控换本（开本前）：可以传内置库 id，也可以传整份解析结果
  socket.on("setScript", ({ scriptId, script }) => {
    const { roomId } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    if (room.gameStarted) return socket.emit("toast", { msg: "本局已经开始，换本请开新房间" });
    let target = script;
    if (!target && scriptId) target = findScript(scriptId);
    if (!applyScript(room, target)) return socket.emit("toast", { msg: "这份剧本内容不完整（缺角色或分幕）" });
    // 保留当前在座的人（重新进房即可继续）
    addNotice(room, "【换本】" + room.script.name);
    persist();
    syncRoom(roomId);
    socket.emit("toast", { msg: "已换成《" + room.script.name + "》" });
  });

  socket.on("giveCluesAct", ({ actIdx }) => {
    const { roomId } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    const sent = giveActClues(roomId, Number(actIdx));
    socket.emit("toast", { msg: sent ? "已发放本幕线索 " + sent + " 条" : "本幕线索都已经发过了" });
  });

  socket.on("join", ({ roomId, name, isDM, plays }) => {
    if (!roomId || !name) return;
    const id = String(roomId).trim().toUpperCase();
    const room = getRoom(id);
    if (room.players[name] && room.players[name].isDM !== !!isDM) {
      socket.emit("toast", { msg: "昵称已被占用，请换一个" });
      return;
    }
    room.players[name] = room.players[name] || { roleId: null };
    room.players[name].isDM = !!isDM;
    room.players[name].plays = isDM ? !!plays : true;   // 中控可选「全职」或「兼职玩家」
    room.trays[name] = room.trays[name] || [];
    if (isDM) room.dmName = name;

    socket.join(id);
    socket.data.roomId = id;
    socket.data.name = name;

    const tag = isDM ? (plays ? "（中控 · 兼职玩家）" : "（中控 · 全职）") : "";
    addNotice(room, `${name} 进入房间${tag}`);
    persist();
    socket.emit("joined", { roomId: id, name, isDM: !!isDM, plays: isDM ? !!plays : true });
    syncRoom(id);
  });

  socket.on("pickRole", ({ roleId }) => {
    const { roomId, name } = socket.data || {};
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.gameStarted) {
      return socket.emit("toast", { msg: "本局已经开本，不能改角色了" });
    }
    const taken = Object.entries(room.players)
      .some(([n, p]) => p.roleId === roleId && n !== name);
    if (taken) return socket.emit("toast", { msg: "这个角色已经被选走了" });
    room.players[name].roleId = roleId;
    const role = room.script.roles.find(r => r.id === roleId);
    addNotice(room, `${name} 选择了角色「${role ? role.name : roleId}」`);
    persist();
    syncRoom(roomId);
  });

  socket.on("setAuto", ({ auto }) => {
    const { roomId } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    room.autoMaster = !!auto;
    addNotice(room, `【主控】切换为 ${room.autoMaster ? "AutoDM 机器人" : "人工 DM"}`);
    if (room.autoMaster && room.gameStarted) scheduleAuto(roomId, room.currentAct + 1);
    else clearTimers(room);
    persist();
    syncRoom(roomId);
  });

  // 调整 AutoDM 节奏（单位秒）：改完从下一幕起生效
  socket.on("setTiming", ({ clueDelay, clueGap, actGap, voteDelay }) => {
    const { roomId } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    const t = normTiming({ clueDelay, clueGap, actGap, voteDelay });
    room.script.autoTiming = t;
    addNotice(room, `【节奏】推幕后 ${fmtMin(t.clueDelay)} 发线索 · 线索间隔 ${fmtMin(t.clueGap)} · 每幕 ${fmtMin(t.actGap)} · 投票等待 ${fmtMin(t.voteDelay)}`);
    if (room.autoMaster && room.gameStarted) scheduleAuto(roomId, room.currentAct + 1);
    else clearTimers(room);
    persist();
    syncRoom(roomId);
    socket.emit("toast", { msg: "节奏已更新，从下一幕开始生效" });
  });

  socket.on("startGame", () => {
    const { roomId } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    if (room.players && Object.values(room.players).filter(p => !p.isDM || p.plays).length === 0) {
      return socket.emit("toast", { msg: "还没有玩家进入房间" });
    }
    room.gameStarted = true;
    room.votes = {};
    room.voteResult = null;
    room.revealOpen = false;
    addNotice(room, "【开本】游戏正式开始");

    // 分发角色任务卡
    for (const [name, p] of Object.entries(room.players)) {
      if (p.isDM && !p.plays) continue;
      const role = room.script.roles.find(r => r.id === p.roleId);
      if (!role) continue;
      const tasks = (role.tasks || []).map((t, i) => `${i + 1}. ${t}`).join("\n");
      const full = [
        `【人物档案】${role.name}`,
        "",
        role.desc || "（这个角色没有更多背景）",
        "",
        "【你的任务】",
        tasks || "自由探索，尽量从别人嘴里问出真话。",
        "",
        "【给你的小提示】",
        "· 先记住自己那一晚的行踪，别人问起时别说漏时间；",
        "· 你的秘密只有你自己知道，什么时候说、对谁说，由你决定；",
        "· 每幕结束前，至少把一条线索放上托盘，方便大家对照时间线。"
      ].join("\n");
      pushTrayItem(room, name, makeItem("task", `人物档案 · ${role.name}`, full, "档案"));
      emitToPlayer(roomId, name, "notify", {
        kind: "task", title: `你的角色：${role.name}`, body: full, hint: "人物档案已放进托盘，开本前先看一遍"
      });
    }

    pushAct(roomId, 0, false);
    if (room.autoMaster) scheduleAuto(roomId, 1);
    persist();
    syncRoom(roomId);
    io.to(roomId).emit("toast", { msg: `开本：《${room.script.name}》，第 1 幕开始` });
  });

  socket.on("pushAct", ({ idx }) => {
    const { roomId } = socket.data || {};
    if (!rooms[roomId]) return;
    pushAct(roomId, Number(idx), false);
  });

  socket.on("giveClue", ({ actIdx, clueIdx }) => {
    const { roomId } = socket.data || {};
    if (!rooms[roomId]) return;
    giveClue(roomId, Number(actIdx), Number(clueIdx));
  });

  socket.on("openVote", () => {
    const { roomId } = socket.data || {};
    if (!rooms[roomId]) return;
    openVote(roomId);
  });

  socket.on("closeVote", () => {
    const { roomId } = socket.data || {};
    if (!rooms[roomId]) return;
    closeVote(roomId);
  });

  socket.on("vote", ({ roleId }) => {
    const { roomId, name } = socket.data || {};
    const room = rooms[roomId];
    if (!room || !room.voteOpen) return;
    room.votes[name] = roleId;
    persist();
    syncRoom(roomId);
    broadcast(roomId, "toast", { msg: `${name} 已提交投票` },
      s => (room.players[s.data.name] || {}).isDM);
  });

  socket.on("hint", ({ level }) => {
    const { roomId } = socket.data || {};
    if (!rooms[roomId]) return;
    sendHint(roomId, Number(level) || 1);
  });

  socket.on("reveal", () => {
    const { roomId } = socket.data || {};
    if (!rooms[roomId]) return;
    sendReveal(roomId);
  });

  socket.on("updateTrayPos", ({ uid, x, y }) => {
    const { roomId, name } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    const arr = room.trays[name] || [];
    const item = arr.find(i => i.uid === uid);
    if (item) {
      item.x = Math.max(0, Number(x));
      item.y = Math.max(0, Number(y));
      persist();
      syncRoom(roomId);
    }
  });

  socket.on("setTrayPositions", ({ positions }) => {
    const { roomId, name } = socket.data || {};
    const room = rooms[roomId];
    if (!room || !Array.isArray(positions)) return;
    const arr = room.trays[name] || [];
    positions.forEach(p => {
      const item = arr.find(i => i.uid === p.uid);
      if (item) { item.x = Number(p.x); item.y = Number(p.y); }
    });
    persist();
    syncRoom(roomId);
  });

  socket.on("tradeClue", ({ to, uid }) => {
    const { roomId, name } = socket.data || {};
    const room = rooms[roomId];
    if (!room) return;
    const arr = room.trays[name] || [];
    const item = arr.find((i) => i.uid === uid);
    if (!item || !room.players[to]) return;
    // 分享是「复印一份」给对方，自己托盘里的原件保留，不会消失
    const copy = makeItem(item.kind, item.title, item.full, item.tag, item.x, item.y);
    pushTrayItem(room, to, copy);
    emitToPlayer(roomId, to, "notify", {
      kind: "clue",
      title: `收到来自 ${name} 的线索`,
      body: copy.full,
      hint: "线索已放入你的托盘（对方还留着原件）"
    });
    addNotice(room, `【分享】${name} 把「${item.title}」发给了 ${to}`);
    persist();
    syncRoom(roomId);
  });

  socket.on("disconnect", () => {
    const { roomId, name } = socket.data || {};
    if (!roomId || !rooms[roomId] || !name) return;
    addNotice(rooms[roomId], `${name} 离开房间`);
    persist();
    syncRoom(roomId);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  剧本杀中控平台已启动");
  console.log("  本机访问： http://127.0.0.1:" + PORT);
  console.log("  同一局域网用 http://<本机IP>:" + PORT);
  console.log("");
  // 启动就自动开公网通道，省得每次手点
  ensureTunnel().then((out) => { if (out && out.url) console.log("  公网联机：", out.url); });
  // 重启后把正在进行的 AutoDM 房间重新排回时间轴，否则倒计时会停在 00:00
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room && room.autoMaster && room.gameStarted) {
      room.script.autoTiming = normTiming(room.script.autoTiming);
      scheduleAuto(roomId, Math.max(0, room.currentAct + 1));
    }
  }
});
