/* 剧本杀线上中控平台 · 前端逻辑 */
const socket = io();
const $ = (id) => document.getElementById(id);

let my = { roomId: null, name: null, isDM: false, plays: true };
let S = null;                 // 当前房间状态（服务端按身份脱敏后下发）
let selectedDMPlayer = null;  // DM 正在查看谁的托盘
let dragging = null;
let zoomItemRef = null;
let zoomFont = 15;
let pending = null;
let dmView = "dm";            // DM 视角：dm = 中控台，player = 我的角色

const ICON = { script: "📖", clue: "🔍", task: "🎯", vote: "🗳️", result: "⚖️", hint: "💡", reveal: "📜" };

const SCRIPT_TEMPLATE = `《在这里写书名》
人数：6
真凶：在这里写真凶名字

## 角色
### 角色 1｜角色名（如：沈知予）
【公开人设】一句话身份 + 性格（选角时别人只看到这句）
【你的故事线】你是谁、和死者什么关系、为什么今晚在场，3~6 句话
【你今晚的时间线】
19:00 你做了什么
20:00 你做了什么（按真实时间写，别人问到要对得上）
【你的秘密，不要主动说】只有你知道的事
【随身物品】你身上带着的东西
【个人任务】
1. 第一条任务
2. 第二条

### 角色 2｜角色名
（按上面格式继续写其他角色）

## 第一幕：开场幕名
【主持人宣读幕启】这一幕开场要念的话
【玩家读本】这一幕的公开剧情，其他人都能看到
线索 1：线索标题
线索的具体内容，换行写在这里
线索 2：另一条线索

## 第二幕：第二幕幕名
（按上面格式继续写）

## 复盘
等游戏结束再念：凶手是谁、怎么作案、动机是什么。`;

boot();

function boot() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) $("inp-room").value = room.toUpperCase();
  $("inp-name").value = localStorage.getItem("pl_name") || "";

  $("btn-new-room").onclick = () => {
    const name = $("inp-name").value.trim() || "DM";
    socket.emit("createRoom", { name });
  };
  socket.on("created", ({ roomId }) => {
    $("inp-room").value = roomId;
    toast("房间已创建：" + roomId);
    if (pending) {
      const p = pending; pending = null;
      doJoin(roomId, p.name, p.asDM, p.plays);
    }
  });

  $("btn-enter-dm").onclick = () => enter(true);
  $("btn-enter-player").onclick = () => enter(false);
  $("btn-copy-dm-link").onclick = () => copyLink();
  $("btn-qr").onclick = () => openQR();
  $("btn-qr-close").onclick = () => $("qr-modal").classList.add("hidden");
  $("btn-tunnel").onclick = () => startTunnel();
  $("btn-back-dm").onclick = () => { dmView = "dm"; render(); };
  $("btn-exit-dm").onclick = () => location.href = "/";
  $("btn-exit-player").onclick = () => location.href = "/";

  $("inp-name").addEventListener("input", () => localStorage.setItem("pl_name", $("inp-name").value));
  $("inp-room").addEventListener("keydown", (e) => { if (e.key === "Enter") enter(false); });

  bindPicker();
  // 粘贴框里直接放一份可复制改编的模板，选中就能改
  $("inp-paste").value = SCRIPT_TEMPLATE;

  bindDM();
  bindPlayer();
  bindPopups();

  socket.on("joined", (info) => {
    my = info;
    $("screen-entry").classList.add("hidden");
    dmView = info.isDM ? "dm" : "player";
    $("dm-room-tag").textContent = "房间 " + info.roomId;
    $("pl-room-tag").textContent = "房间 " + info.roomId;
    $("dm-view-tabs").classList.toggle("hidden", !info.plays);
    $("btn-back-dm").classList.toggle("hidden", !info.isDM);
    // 进房瞬间就把对应界面显示出来，别等 state 到达（否则有短暂白屏）
    $("screen-dm").classList.toggle("hidden", !info.isDM);
    $("screen-player").classList.toggle("hidden", !!info.isDM && !info.plays);
    render();
  });
  socket.on("state", (st) => {
    const prevAct = S ? S.currentAct : -1;
    S = st;
    render();
    if (st.gameStarted && st.currentAct !== prevAct) flashAutoBar();
  });
  socket.on("toast", (p) => toast(p.msg));
  socket.on("notify", (p) => showPopup(p));
}

let scriptDraft = null;      // 第 1 步解析出来的剧本（开新房间时带上去）

function enter(asDM) {
  const name = $("inp-name").value.trim();
  const room = $("inp-room").value.trim().toUpperCase();
  const plays = asDM ? $("chk-dm-play").checked : true;
  if (!name) { toast("请先填写昵称"); $("inp-name").focus(); return; }
  if (!room) {
    pending = { name, asDM, plays, script: scriptDraft ? scriptDraft.script : null };
    socket.emit("createRoom", {
      name,
      script: scriptDraft ? scriptDraft.script : null
    });
    return;
  }
  doJoin(room, name, asDM, plays);
}

/** 从内置剧本库开局 */
function startWithLibrary(id, name) {
  const nick = $("inp-name").value.trim();
  if (!nick) { toast("先填昵称，再用这个本开局"); $("inp-name").focus(); return; }
  pending = { name: nick, asDM: true, plays: $("chk-dm-play").checked, script: null };
  socket.emit("createRoom", { name: nick, scriptId: id });
  toast("正在用《" + name + "》建房间…");
}

function doJoin(roomId, name, asDM, plays) {
  socket.emit("join", { roomId, name, isDM: asDM, plays: asDM ? !!plays : true });
}

/* ---------- 第 1 步：选本 / 上传解析 / 剧本库 ---------- */
const THEME_NAME = { paper: "纸张", night: "雨夜悬疑", ancient: "古风", campus: "校园", horror: "恐怖" };

function bindPicker() {
  document.querySelectorAll(".pick-tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".pick-tab").forEach((x) => x.classList.toggle("active", x === t));
      ["file", "lib", "gen", "text"].forEach((k) => {
        const pane = $("tab-" + k);
        if (pane) pane.classList.toggle("hidden", k !== t.dataset.tab);
      });
    };
  });

  $("btn-pick-file").onclick = () => $("inp-files").click();
  $("btn-pick-folder").onclick = () => $("inp-folder").click();
  $("inp-files").onchange = (e) => { parseFiles(e.target.files); e.target.value = ""; };
  $("inp-folder").onchange = (e) => { parseFiles(e.target.files); e.target.value = ""; };

  const dz = $("drop-zone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add("hot");
  }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove("hot");
  }));
  dz.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) parseFiles(e.dataTransfer.files);
    else toast("拖文件夹请用「选整个文件夹」按钮");
  });

  $("btn-parse-paste").onclick = () => {
    const text = $("inp-paste").value.trim();
    if (!text) return toast("先粘贴一段剧本文字");
    const b64 = btoa(unescape(encodeURIComponent(text)));
    postJSON("/api/parse", { files: [{ name: "粘贴的剧本.txt", data: b64 }] });
  };
  $("btn-parse-url").onclick = () => {
    const url = $("inp-url").value.trim();
    if (!url) return toast("先填链接");
    postJSON("/api/import", { url });
  };

  $("btn-generate").onclick = generateDraft;

  loadLibrary();
}

/* 自动生成一本：人数 + 风格 → 完整剧本（含人物资料 / 分幕 / 线索 / 复盘） */
async function generateDraft() {
  const count = Number($("inp-gen-count").value || 4);
  const style = $("sel-gen-style").value || "night";
  const title = $("inp-gen-title").value.trim();
  const box = $("gen-status");
  if (count < 3 || count > 8) {
    box.className = "parse-status err";
    box.textContent = "参加人数请填 3 ~ 8 人";
    box.classList.remove("hidden");
    return;
  }
  box.className = "parse-status";
  box.textContent = "正在生成剧本（角色资料、三幕剧情、线索、复盘都要写到）…";
  box.classList.remove("hidden");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, style, title })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setDraft(data);
    box.className = "parse-status";
    const warn = (data.warnings || []).filter(Boolean).join("；");
    box.textContent = (warn ? "⚠ " + warn + " —— " : "") +
      `生成好了：《${data.script.name}》· ${data.script.roles.length} 个角色 · ${data.script.acts.length} 幕。下面确认一下就开房。`;
  } catch (e) {
    box.className = "parse-status err";
    box.textContent = "生成失败：" + (e.message || "未知错误");
  }
}

function parseStatus(msg, isErr) {
  const el = $("parse-status");
  el.className = "parse-status" + (isErr ? " err" : "");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(new Error("读取失败：" + file.name));
    fr.readAsDataURL(file);
  });
}

async function parseFiles(fileList) {
  const all = Array.from(fileList || []);
  const ok = all.filter((f) => /\.(docx|txt|md|csv|json)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
  if (!ok.length) {
    return parseStatus("没找到能解析的文件：支持 .docx / .txt / .md（旧版 .doc 请另存为 .docx）", true);
  }
  parseStatus("正在解析 " + ok.length + " 个文件…");
  try {
    const files = [];
    for (const f of ok) files.push({ name: f.name, data: await toBase64(f) });
    const out = await postJSON("/api/parse", { files });
    if (out.error) throw new Error(out.error);
    parseStatus("解析完成：" + out.script.name + "（" + ok.length + " 个文件）");
    setDraft(out);
  } catch (e) {
    parseStatus("解析失败：" + (e.message || "未知错误"), true);
  }
}

async function postJSON(url, body) {
  parseStatus("正在处理…");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    parseStatus("");
    setDraft(data);
    return data;
  } catch (e) {
    parseStatus(e.message || "处理失败", true);
    throw e;
  }
}

function setDraft(out) {
  if (!out || !out.script) return;
  scriptDraft = out;
  renderPreview(out);
}

function renderPreview(out) {
  const s = out.script;
  const box = $("script-preview");
  const warns = (out.warnings || []).filter(Boolean);
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="preview-head">
      <div>
        <b>《${esc(s.name)}》</b>
        <span class="muted small">${esc(s.type)} · ${s.roles.length} 个角色 · ${s.acts.length} 幕</span>
      </div>
      <button class="btn ghost sm" id="btn-clear-script">不用这个本</button>
    </div>
    <div class="preview-roles">${s.roles.map((r) => `<span class="chip">${r.avatar || "🎭"} ${esc(r.name)}</span>`).join("")}</div>
    <div class="preview-acts">${s.acts.map((a, i) =>
      `<div class="preview-act"><b>第 ${i + 1} 幕</b> ${esc(a.title)} <span class="muted">· ${a.clues.length} 条线索</span></div>`).join("")}</div>
    <div class="preview-theme">
      <label>整体风格</label>
      <select id="pick-theme" class="select">
        ${Object.keys(THEME_NAME).map((k) =>
          `<option value="${k}" ${k === s.theme ? "selected" : ""}>${THEME_NAME[k]}</option>`).join("")}
      </select>
    </div>
    ${warns.length ? `<div class="preview-warn">${warns.map(esc).join("<br>")}</div>` : ""}
    <div class="btn-row">
      <button class="btn primary" id="btn-use-script">用这个本开新房间</button>
      <button class="btn ghost sm" id="btn-save-lib">存进剧本库</button>
    </div>`;
  $("btn-save-lib").onclick = async () => {
    try {
      const r = await fetch("/api/saveScript", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptDraft.script })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "保存失败");
      toast("已存进剧本库：《" + j.name + "》，下次在「剧本库」页签直接选");
      loadLibrary();
    } catch (e) { toast(e.message || "保存失败"); }
  };
  $("btn-clear-script").onclick = () => {
    scriptDraft = null;
    box.classList.add("hidden");
    box.innerHTML = "";
    parseStatus("");
  };
  $("btn-use-script").onclick = () => {
    if (scriptDraft && scriptDraft.script) applyTheme(scriptDraft.script.theme);
    enter(true);
  };
  $("pick-theme").onchange = (e) => {
    if (scriptDraft && scriptDraft.script) {
      scriptDraft.script.theme = e.target.value;
      applyTheme(e.target.value);
    }
  };
  applyTheme(s.theme);
}

function applyTheme(theme) {
  document.body.dataset.theme = THEME_NAME[theme] ? theme : "paper";
}

async function loadLibrary() {
  try {
    // AI 状态提示
    fetch("/api/ai").then((r) => r.json()).then((st) => {
      const el = $("gen-ai-hint");
      if (!el) return;
      el.textContent = st.enabled
        ? "当前用 " + st.label + "（" + st.model + "）现写剧本。"
        : "当前用模板生成（离线、秒出本）。在 data/ai.json 里填上 API Key 就会自动切换成 AI 现写。";
    }).catch(() => {});
    const out = await (await fetch("/api/library")).json();
    // 自动生成页的风格下拉
    const sel = $("sel-gen-style");
    if (sel && out.styles) {
      sel.innerHTML = out.styles.map((s) => `<option value="${s.id}">${esc(s.label)} · ${esc(s.desc || "")}</option>`).join("");
    }
    $("lib-list").innerHTML = (out.scripts || []).map((s) => `
      <div class="lib-card">
        <div class="lib-head"><b>《${esc(s.name)}》</b><span class="badge">${s.custom ? "我存的" : esc(s.type)}</span></div>
        <p>${esc(s.intro || "")}</p>
        <div class="lib-foot">
          <span class="muted small">${s.roles} 个角色 · ${s.acts} 幕 · 画风：${THEME_NAME[s.theme] || "纸张"}</span>
          <span>
            ${s.custom ? `<button class="btn ghost sm danger" data-del="${s.id}" data-name="${esc(s.name)}">删除</button>` : ""}
            <button class="btn sm" data-lib="${s.id}" data-name="${esc(s.name)}">用这本开局</button>
          </span>
        </div>
      </div>`).join("") || '<div class="muted small">剧本库为空</div>';
    $("lib-list").querySelectorAll("[data-lib]").forEach((b) => {
      b.onclick = () => startWithLibrary(b.dataset.lib, b.dataset.name);
    });
    $("lib-list").querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("确定把《" + b.dataset.name + "》从剧本库删掉？")) return;
        const r = await fetch("/api/script/" + encodeURIComponent(b.dataset.del), { method: "DELETE" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return toast(j.error || "删除失败");
        toast("已删除《" + b.dataset.name + "》");
        loadLibrary();
      };
    });
  } catch (e) {
    $("lib-list").innerHTML = '<div class="muted small">剧本库读取失败：' + esc(e.message) + "</div>";
  }
}

function copyLink() {
  const url = location.origin + "/?room=" + my.roomId;
  navigator.clipboard.writeText(url).then(
    () => toast("邀请链接已复制：" + url),
    () => toast("复制失败，请手动复制：" + url)
  );
}

/** 二维码弹窗：优先用局域网地址，手机扫码即可加入；可再开启公网通道 */
let qrInfo = null;

function renderQR(target) {
  $("qr-img").src = "/api/qr?url=" + encodeURIComponent(target);
}

async function openQR() {
  let info = null;
  try {
    info = await (await fetch("/api/net")).json();
  } catch (e) { info = null; }
  qrInfo = info;
  const code = my.roomId;
  const ips = (info && info.ips) || [];
  const prefer = ips.find((a) => a.ip.indexOf("192.168.") === 0) || ips[0];
  const lanBase = prefer ? prefer.url : location.origin;

  $("qr-code").textContent = code;
  $("qr-addrs").innerHTML = ips.length
    ? ips.map((a) =>
        `<span class="addr">${esc(a.url)}/?room=${esc(code)} · ${esc(a.name)}</span>`).join("")
    : '<span class="addr">未检测到局域网地址（可能没连 WiFi），只能本机访问</span>';

  const wanUrl = (info && info.publicUrl) || null;
  if (wanUrl) {
    $("qr-wan-url").innerHTML = `<span class="addr">${esc(wanUrl)}/?room=${esc(code)}</span>`;
    $("btn-tunnel").textContent = "刷新公网通道";
    renderQR(wanUrl + "/?room=" + code);
  } else {
    $("qr-wan-url").innerHTML = '<span class="addr">还没开启，点了按钮后生成公网地址</span>';
    $("btn-tunnel").textContent = "开启公网通道";
    renderQR(lanBase + "/?room=" + code);
  }
  $("qr-modal").classList.remove("hidden");
  // 没开隧道就自动开一个，省得每次手点
  if (!wanUrl) startTunnel();
}

async function startTunnel() {
  const btn = $("btn-tunnel");
  btn.disabled = true;
  btn.textContent = "开启中…（约 5-10 秒）";
  $("qr-wan-url").innerHTML = '<span class="addr">正在连接公网通道…</span>';
  try {
    const out = await (await fetch("/api/tunnel")).json();
    if (out.url) {
      $("qr-wan-url").innerHTML =
        `<span class="addr">${esc(out.url)}/?room=${esc(my.roomId)}</span>`;
      renderQR(out.url + "/?room=" + my.roomId);
      toast("公网通道已开启，二维码已切换为公网地址");
      btn.textContent = "刷新公网通道";
    } else {
      throw new Error(out.error || "公网通道暂时不可用");
    }
  } catch (e) {
    $("qr-wan-url").innerHTML =
      '<span class="addr">开启失败：' + esc(e.message) + "（可改用 cloudflared / ngrok）</span>";
    btn.textContent = "重试开启公网通道";
  } finally {
    btn.disabled = false;
  }
}

function render() {
  if (!S) return;
  applyTheme((S.game && S.game.theme) || "paper");   // 整体画风跟随剧本情景
  if (my.isDM) {
    document.querySelectorAll("#dm-view-tabs .tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === dmView);
    });
    const asPlayer = dmView === "player" && S.me.plays;
    $("screen-dm").classList.toggle("hidden", asPlayer);
    $("screen-player").classList.toggle("hidden", !asPlayer);
    $("btn-back-dm").classList.toggle("hidden", !asPlayer);
    if (asPlayer) renderPlayer(); else renderDM();
  } else {
    // 普通玩家：必须显式显示玩家界面，否则进房后是一片空白
    $("screen-entry").classList.add("hidden");
    $("screen-dm").classList.add("hidden");
    $("screen-player").classList.remove("hidden");
    renderPlayer();
  }
}

/* ---------- 提示条 ---------- */
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ---------- AutoDM 倒计时条（DM 和玩家各一条，同一份数据） ---------- */
const autoShown = { dm: null, pl: null };   // 记录上一次的动作时间点，用来判断总时长

function autoIds(side) {
  return side === "dm"
    ? { bar: "auto-bar", label: "auto-label", clock: "auto-clock", fill: "auto-fill" }
    : { bar: "pl-auto-bar", label: "pl-auto-label", clock: "pl-auto-clock", fill: "pl-auto-fill" };
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function renderAutoBar(side) {
  const ids = autoIds(side);
  const bar = $(ids.bar);
  if (!bar) return;
  const next = S && S.autoNext;
  if (!next || !S.autoMaster) {
    bar.classList.add("hidden");
    autoShown[side] = null;
    return;
  }
  bar.classList.remove("hidden");
  if (autoShown[side] !== next.at) {
    autoShown[side] = next.at;
    $(ids.label).textContent = next.label || "下一步";
  }
  tickAutoBar(side);
}

function tickAutoBar(side) {
  const ids = autoIds(side);
  const bar = $(ids.bar);
  if (!bar || bar.classList.contains("hidden")) return;
  const next = S && S.autoNext;
  if (!next) return;
  const left = next.at - Date.now();
  $(ids.clock).textContent = left > 0 ? fmtClock(left) : "00:00";
  const total = Math.max(6000, next.leftMs || 0);
  $(ids.fill).style.width = Math.max(0, Math.min(100, (left / total) * 100)) + "%";
  bar.classList.toggle("urgent", left <= 10000);
  bar.classList.toggle("done", left <= 0);
}

setInterval(() => {
  tickAutoBar("dm");
  tickAutoBar("pl");
}, 1000);

/** 新一幕开始：把倒计时条闪一下，让人一眼看到"新一轮开始了" */
function flashAutoBar() {
  ["dm", "pl"].forEach((side) => {
    const bar = $(autoIds(side).bar);
    if (!bar) return;
    bar.classList.remove("fire");
    void bar.offsetWidth;
    bar.classList.add("fire");
    setTimeout(() => bar.classList.remove("fire"), 3200);
  });
}
/* ---------- 中控台 ---------- */
function bindDM() {
  document.querySelectorAll('input[name="masterMode"]').forEach((r) => {
    r.addEventListener("change", () => {
      socket.emit("setAuto", { auto: r.value === "auto" });
    });
  });
  $("guide-btn").onclick = () => runGuide();
  $("btn-open-vote").onclick = () => socket.emit("openVote", {});
  $("btn-close-vote").onclick = () => socket.emit("closeVote", {});
  $("btn-give-all").onclick = () => {
    if (S.currentAct < 0) return toast("先推送第一幕");
    socket.emit("giveCluesAct", { actIdx: S.currentAct });
  };
  $("btn-reveal").onclick = () => socket.emit("reveal", {});
  $("btn-save-timing").onclick = () => {
    const payload = {};
    ["clueDelay", "clueGap", "actGap", "voteDelay"].forEach((k) => {
      // 界面按分钟填，服务端存秒
      payload[k] = Math.round(Number($("tm-" + k).value) * 60);
    });
    socket.emit("setTiming", payload);
  };
  $("dm-tray-select").onchange = (e) => {
    selectedDMPlayer = e.target.value || null;
    renderDMTray();
  };
  document.querySelectorAll("#dm-view-tabs .tab").forEach((b) => {
    b.onclick = () => { dmView = b.dataset.view; render(); };
  });
}

/* ---------- 中控台：系统提示（告诉 DM 下一步做什么） ---------- */
let guideAction = "none";
let hintShown = {};           // 扶车提示是否已展开（默认模糊）

function guideState(names, ready) {
  const last = S.actCount - 1;
  if (!S.gameStarted) {
    return {
      title: names.length ? `已到场 ${names.length} 位玩家` : "还没有玩家进入房间",
      desc: names.length
        ? `${ready}/${names.length} 人选好角色。点右边按钮，所有人会同时收到任务卡和第一幕剧本。`
        : "先点右上角「邀请二维码」，让玩家扫码进房。",
      label: "正式开本",
      action: "start",
      disabled: !names.length
    };
  }
  if (S.currentAct < last) {
    return {
      title: `正在演第 ${S.currentAct + 1} 幕 · ${S.actTitle}`,
      desc: "玩家在读本。可以先去 ② 发线索；聊得差不多就推进下一幕。" +
        (S.autoMaster ? "（AutoDM 会自动推进，手动点会立刻生效）" : ""),
      label: `推送第 ${S.currentAct + 2} 幕`,
      action: "next",
      disabled: false
    };
  }
  if (!S.voteOpen && !S.voteResult) {
    return {
      title: "已经演到最后一幕",
      desc: "等大家讨论充分再开投票；开投票前别剧透真凶。",
      label: "开启投凶",
      action: "vote",
      disabled: false
    };
  }
  if (S.voteOpen) {
    const voted = Object.keys((S.dm || {}).votes || {}).length;
    return {
      title: `投票进行中：${voted}/${names.length} 人已投`,
      desc: "都投完就可以结算。想知道谁投了谁，看 ④ 区块。",
      label: "结算投票",
      action: "close",
      disabled: false
    };
  }
  if (!S.revealOpen) {
    return {
      title: "投票已结算，真相可以揭晓了",
      desc: "先让玩家自己推一遍，再把复盘发给所有人。",
      label: "放出复盘",
      action: "reveal",
      disabled: false
    };
  }
  return {
    title: "本局结束，辛苦啦",
    desc: "可以再开一局，或者让大家继续对着托盘复盘。",
    label: "已完成",
    action: "none",
    disabled: true
  };
}

function renderGuide(names, ready) {
  const g = guideState(names, ready);
  guideAction = g.action;
  $("guide-title").textContent = g.title;
  $("guide-desc").textContent = g.desc;
  const btn = $("guide-btn");
  btn.textContent = g.label;
  btn.disabled = !!g.disabled;
}

function runGuide() {
  if (guideAction === "start") socket.emit("startGame", {});
  else if (guideAction === "next") socket.emit("pushAct", { idx: S.currentAct + 1 });
  else if (guideAction === "vote") socket.emit("openVote", {});
  else if (guideAction === "close") socket.emit("closeVote", {});
  else if (guideAction === "reveal") socket.emit("reveal", {});
  else toast("本局已经结束啦");
}

function renderDM() {
  const dm = S.dm || {};
  $("dm-mode-badge").textContent = S.autoMaster ? "🤖 AutoDM" : "👤 人工 DM";
  $("dm-mode-badge").style.color = S.autoMaster ? "#8f3b2a" : "#5a7d9a";
  $("dm-act-badge").textContent = S.gameStarted
    ? "第 " + (S.currentAct + 1) + "/" + S.actCount + " 幕 · " + S.actTitle
    : "未开本";

  const names = Object.keys(S.players).filter((n) => !S.players[n].isDM);
  const playersReady = Object.keys(S.players).filter((n) => {
    const p = S.players[n];
    return !p.isDM && p.roleId;
  }).length;

  renderGuide(names, playersReady);

  document.querySelectorAll('input[name="masterMode"]').forEach((r) => {
    r.checked = (r.value === "auto") === !!S.autoMaster;
    r.closest(".mode-opt").classList.toggle("active", r.checked);
  });

  // AutoDM 节奏：把服务端的时间间隔（秒）换算成分钟填进输入框（正在输入的那个不要抢）
  const timing = S.autoTiming || {};
  ["clueDelay", "clueGap", "actGap", "voteDelay"].forEach((k) => {
    const el = $("tm-" + k);
    if (el && document.activeElement !== el && timing[k] != null) {
      el.value = Math.round((timing[k] / 60) * 10) / 10;
    }
  });
  renderAutoBar("dm");

  // 玩家列表
  $("dm-players").innerHTML = names.length
    ? names.map((n) => {
        const p = S.players[n];
        const role = (S.game.roles.find((r) => r.id === p.roleId) || {});
        const trayCount = ((dm.trays || {})[n] || []).length;
        return `<div class="player-row">
          <div class="who"><span class="status ${p.online ? "on" : ""}"></span>
            <div>${esc(n)}<div class="role">${role.name ? "角色：" + esc(role.name) : "未选角色"} · 托盘 ${trayCount}</div></div>
          </div>
        </div>`;
      }).join("")
    : '<div class="muted small">还没有玩家进入，点右上「邀请二维码」发给玩家扫码</div>';

  // 我的角色（仅兼职中控）
  const box = $("dm-my-role-box");
  const mine = !!S.me.plays;
  box.classList.toggle("hidden", !mine);
  if (mine) {
    const sel = $("dm-role-select");
    const opts = S.game.roles.map((r) => {
      const takenBy = Object.keys(S.players).find(
        (n) => S.players[n].roleId === r.id && n !== S.me.name
      );
      const on = S.me.roleId === r.id ? " selected" : "";
      const off = takenBy ? " disabled" : "";
      return `<option value="${r.id}"${on}${off}>${esc(r.name)}${takenBy ? "（已被 " + esc(takenBy) + " 选）" : ""}</option>`;
    }).join("");
    sel.innerHTML = '<option value="">— 还没选角色 —</option>' + opts;
    sel.disabled = S.gameStarted;
    sel.onchange = () => {
      if (sel.value) socket.emit("pickRole", { roleId: sel.value });
    };
  }

  // 分区①：剧情推进（只要幕卡片 + 一个推送按钮）
  const acts = dm.acts || [];
  $("dm-timeline").innerHTML = acts.map((a) => {
    const pushed = a.idx <= S.currentAct;
    const cur = a.idx === S.currentAct ? "current" : (a.idx < S.currentAct ? "done" : "");
    const state = pushed
      ? (a.idx === S.currentAct ? "进行中" : "已推送")
      : "未推送";
    const clueCount = (a.clues || []).length;
    return `<div class="act-card ${cur}">
      <h3>${esc(a.title)}<span class="idx">第 ${a.idx + 1} 幕 · ${state}</span></h3>
      <p>${esc(a.public)}</p>
      <div class="act-foot">
        <span class="clue-count">本幕 ${clueCount} 条线索 → 去 ② 发放</span>
        <button class="btn sm" data-push="${a.idx}" ${pushed ? "disabled" : ""}>
          ${pushed ? "已推送" : "推送本幕"}
        </button>
      </div>
    </div>`;
  }).join("") || '<div class="muted small">剧本加载中…</div>';

  $("dm-timeline").querySelectorAll("[data-push]").forEach((b) => {
    b.onclick = () => socket.emit("pushAct", { idx: Number(b.dataset.push) });
  });

  // 分区②：线索发放（一键发放本幕全部线索）
  const board = $("dm-clues");
  const actIdx = S.currentAct;
  const btnAll = $("btn-give-all");
  const statusEl = $("dm-clue-status");
  if (actIdx < 0 || !acts[actIdx]) {
    btnAll.disabled = true;
    btnAll.textContent = "一键发放本幕线索";
    statusEl.innerHTML = '<span class="muted small">先推送第一幕，线索才会准备好。</span>';
  } else {
    const given = (dm.givenClues || {})[String(actIdx)] || [];
    const clues = acts[actIdx].clues || [];
    const left = clues.length - given.length;
    btnAll.disabled = !left;
    btnAll.textContent = left
      ? `一键发放本幕线索（剩 ${left} 条）`
      : "本幕线索已全部发放";
    const list = clues.map((c) => {
      const toName = c.to === "all" ? "全体" : ((S.game.roles.find((r) => r.id === c.to) || {}).name || c.to);
      return `<li>${esc(c.id)} · ${esc(c.title)} <span class="muted">→ ${esc(toName)}</span></li>`;
    }).join("");
    statusEl.innerHTML =
      `<div class="clue-count-line">本幕共 <b>${clues.length}</b> 条，已发 <b>${given.length}</b> 条${
        left ? "，还剩 <b>" + left + "</b> 条" : "，都发完了"}</div>` +
      (clues.length ? `<details class="clue-detail"><summary>本幕会发什么（点开看，玩家看不到）</summary><ul>${list}</ul></details>` : "");
  }

  // 投票进度
  const votes = Object.entries(dm.votes || {});
  const killer = (dm.roles || []).find((r) => r.isKiller) || {};
  $("dm-votes").innerHTML = S.voteOpen
    ? "<div class='muted small'>投票进行中：" + votes.length + " / " + names.length + " 人已投票</div>"
      + votes.map(([n, rid]) => {
          const r = (dm.roles || []).find((x) => x.id === rid) || {};
          return "<div>" + esc(n) + " → " + esc(r.name || rid) + "</div>";
        }).join("")
    : (S.voteResult
        ? "<div class='muted small'>已结算</div><div>" + esc(S.voteResult.counts) + "</div>"
        : "<div class='muted small'>尚未开启投票</div>");

  // 日志
  $("dm-notices").innerHTML = (S.notices || []).slice().reverse()
    .map((n) => "<div>" + esc(typeof n === "string" ? n : n.text) + "</div>").join("");

  // 分区⑤：扶车提示（默认模糊遮住，且绝不写凶手是谁）
  const hintWrap = $("dm-hints");
  const hints = dm.hints || {};
  const playingDM = !!S.me.plays;   // 中控兼玩家：本局不给看提示原文，避免剧透
  hintWrap.innerHTML = [1, 2, 3].map((lv) => {
    const raw = hints[lv] || hints[String(lv)] || "（本剧本没有准备这一档提示）";
    const shown = hintShown[lv] || playingDM;
    const cls = shown ? "" : "masked";
    return `<div class="hint-card ${playingDM ? "locked" : ""}">
      <div class="hint-head">
        <b>${["", "轻度", "中度", "强"][lv]}提示</b>
        <span class="hint-warn">${playingDM ? "你以玩家身份参与，本局不给看原文" : shown ? "已展开" : "含剧情指向，确认再打开"}</span>
      </div>
      <p class="hint-text ${cls}">${esc(playingDM ? "你是兼职中控（DM 兼玩家），为避免剧透，本局隐藏扶车原文。点下面的按钮，玩家会收到这条提示。" : raw)}</p>
      <div class="btn-row">
        ${playingDM ? "" : `<button class="btn ghost sm" data-hint-view="${lv}">${shown ? "遮回去" : "点开核对"}</button>`}
        <button class="btn sm" data-hint-send="${lv}">发送给玩家</button>
      </div>
    </div>`;
  }).join("");
  hintWrap.querySelectorAll("[data-hint-send]").forEach((b) => {
    b.onclick = () => socket.emit("hint", { level: Number(b.dataset.hintSend) });
  });
  hintWrap.querySelectorAll("[data-hint-view]").forEach((b) => {
    b.onclick = () => {
      const lv = b.dataset.hintView;
      hintShown[lv] = !hintShown[lv];
      renderDM();
    };
  });

  // 私有备注（含真凶姓名，兼职中控同样遮住）
  $("dm-note").textContent = playingDM
    ? "【已隐藏】\n你是兼职中控（DM 兼玩家），本局的真凶信息与控场建议对你隐藏，避免你被剧透。\n\n需要完整中控视角，请在入口页取消勾选「DM 同时以玩家身份参与」，用另一个窗口开全职中控。"
    : "真凶：" + (killer.name || "未设定") +
      "\n\n控场建议：\n· 第一幕主打氛围，别急着发线索，先让玩家互相试探\n· 玩家卡壳先给轻度提示，别一次给到底\n· 中推之后还没人碰关键物件，再考虑强提示\n· 投完票再放复盘；复盘里带关键线索编号，方便玩家回看";

  // 托盘下拉
  const sel = $("dm-tray-select");
  const cur = selectedDMPlayer || names[0] || "";
  sel.innerHTML = names.map((n) => `<option value="${esc(n)}" ${n === cur ? "selected" : ""}>${esc(n)} 的托盘</option>`).join("")
    || '<option value="">暂无玩家</option>';
  if (!selectedDMPlayer && cur) selectedDMPlayer = cur;
  renderDMTray();
}

function renderDMTray() {
  const dm = S.dm || {};
  const items = ((dm.trays || {})[selectedDMPlayer] || []);
  $("dm-mini-tray").innerHTML = items.length
    ? items.map((it, i) => `<span class="clue-chip" data-mi="${i}"
        style="display:block;margin:6px">第${i + 1}张 · ${esc(it.tag)} · ${esc(it.title)}</span>`).join("")
    : '<div class="muted small" style="padding:10px">该玩家还没有拿到任何内容</div>';
  $("dm-mini-tray").querySelectorAll("[data-mi]").forEach((el) => {
    el.onclick = () => openZoom(items[Number(el.dataset.mi)]);
  });
}
/* ---------- 玩家端 ---------- */
function bindPlayer() {
  $("btn-arrange").onclick = () => arrangeTray();
  $("btn-tasks").onclick = () => {
    const tasks = (S.tray || []).filter((i) => i.kind === "task");
    if (!tasks.length) return toast("还没有任务卡，等开本后下发");
    openZoom(tasks[tasks.length - 1]);
  };
  $("btn-submit-vote").onclick = () => {
    const picked = document.querySelector('input[name="voteRole"]:checked');
    if (!picked) return toast("请先选择一个角色再提交");
    socket.emit("vote", { roleId: picked.value });
  };
}

function renderPlayer() {
  const role = S.myRole;
  renderAutoBar("pl");
  $("pl-role-badge").textContent = role ? "我的角色：" + role.name : "未选角色";
  $("pl-act-badge").textContent = S.gameStarted
    ? "第 " + (S.currentAct + 1) + "/" + S.actCount + " 幕 · " + S.actTitle
    : "等待开本";

  $("player-lobby").classList.toggle("hidden", S.gameStarted);
  $("player-game").classList.toggle("hidden", !S.gameStarted);

  // 顶部状态条（像素 HUD）
  const tray = S.tray || [];
  $("hud-role").textContent = role ? role.name : "未选";
  $("hud-act").textContent = S.gameStarted
    ? "第 " + (S.currentAct + 1) + "/" + S.actCount + " 幕"
    : "等待开本";
  $("hud-items").textContent = tray.length + " 张";
  $("hud-clues").textContent = tray.filter((i) => i.kind === "clue").length + " 条";

  if (!S.gameStarted) {
    $("role-cards").innerHTML = S.game.roles.map((r) => {
      const takenBy = Object.keys(S.players).find((n) => S.players[n].roleId === r.id && !S.players[n].isDM);
      const mine = S.me.roleId === r.id;
      const cls = mine ? "mine" : (takenBy ? "taken" : "");
      const blurb = r.short || ((r.desc || "").split("\n").find((l) => l.indexOf("身份：") === 0) || "").replace(/^身份：/, "").trim() || "（一句话人设，开本后下发完整剧本）";
      const shortBlurb = blurb.length > 42 ? blurb.slice(0, 42) + "…" : blurb;
      return `<div class="role-card ${cls}" data-role="${r.id}">
        <div class="avatar">${r.avatar || "🎭"}</div>
        <h3>${esc(r.name)}</h3>
        <p class="role-blurb">${esc(shortBlurb)}</p>
        <div class="state">${mine ? "已选择（可重新选）" : (takenBy ? "已被 " + esc(takenBy) + " 选择" : "选我")}</div>
      </div>`;
    }).join("");
    $("role-cards").querySelectorAll("[data-role]").forEach((card) => {
      const rid = card.dataset.role;
      const taken = Object.keys(S.players).some(
        (n) => S.players[n].roleId === rid && n !== S.me.name
      );
      if (taken) return;
      card.onclick = () => socket.emit("pickRole", { roleId: rid });
    });
    $("lobby-desc").textContent = S.me.roleId
      ? "角色已锁定，等待中控开本。开本后你会收到专属剧本与任务卡。"
      : "选择一个角色。选角阶段只展示人设，开本后才会下发完整剧本。";
    if (S.autoMaster) { /* 仅提示 */ }
  } else {
    if (!dragging) renderTray();
    renderVote(role);
    $("pl-notices").innerHTML = (S.notices || []).slice(-6).reverse()
      .map((n) => esc(typeof n === "string" ? n : n.text)).join("<br>");
  }
}

function renderVote(role) {
  $("vote-panel").classList.toggle("hidden", !S.voteOpen);
  if (!S.voteOpen) return;
  $("vote-options").innerHTML = S.game.roles.map((r) => `
    <label class="vote-option" data-v="${r.id}">
      <input type="radio" name="voteRole" value="${r.id}" />
      ${r.avatar || ""} ${esc(r.name)}
    </label>`).join("");
  $("vote-options").querySelectorAll(".vote-option").forEach((l) => {
    l.onclick = () => {
      $("vote-options").querySelectorAll(".vote-option").forEach((x) => x.classList.remove("active"));
      l.classList.add("active");
    };
  });
}

/* ---------- 托盘渲染与拖拽 ---------- */
function paperWidth() {
  const probe = document.querySelector(".paper");
  return (probe && probe.offsetWidth) || (window.innerWidth <= 560 ? 168 : 212);
}

function renderTray() {
  const layer = $("tray-layer");
  const items = S.tray || [];
  const wrap = layer.parentElement;
  const viewW = (wrap && wrap.clientWidth) || window.innerWidth - 40;
  const pw = paperWidth();
  // 托盘画布按内容自动变宽：手机上横向滚动，不会把纸条挤到看不见的地方
  const needW = items.reduce((m, it) => Math.max(m, (it.x || 0) + pw + 24), viewW);
  layer.style.width = Math.max(viewW, needW) + "px";
  const maxY = items.reduce((m, it) => Math.max(m, (it.y || 0) + 210), 0);
  layer.style.height = Math.max(520, maxY + 30) + "px";
  layer.innerHTML = "";

  items.forEach((it, i) => {
    const el = document.createElement("div");
    el.className = "paper " + (it.kind || "script");
    el.style.left = (it.x || 0) + "px";
    el.style.top = (it.y || 0) + "px";
    el.style.zIndex = 10 + i;
    el.dataset.uid = it.uid;
    el.innerHTML = `
      <span class="tag ${tagClass(it.kind)}">${esc(it.tag || "纸条")}</span>
      <h4>${esc(it.title)}</h4>
      <p>${esc(it.short)}</p>
      <div class="ops">
        <button data-op="zoom">放大</button>
        <button data-op="trade">分享</button>
      </div>`;
    el.querySelector('[data-op="zoom"]').onclick = (e) => {
      e.stopPropagation(); openZoom(it);
    };
    el.querySelector('[data-op="trade"]').onclick = (e) => {
      e.stopPropagation(); tradeItem(it);
    };
    el.addEventListener("pointerdown", (e) => startDrag(e, it, el));
    layer.appendChild(el);
  });
}

function tagClass(kind) {
  if (kind === "clue") return "线索";
  if (kind === "task") return "任务";
  return "剧本";
}

/** 按下纸条：不是按按钮才允许拖动；轻点（没移动）则直接放大阅读 */
function startDrag(e, item, el) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  if (e.target.closest("button")) return;          // 按钮自己的点击，别被拖拽吃掉
  dragging = {
    item, el, pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    originX: item.x || 0, originY: item.y || 0,
    moved: false
  };
  // 不在按下时 preventDefault：否则手机上整个托盘区被锁死，无法滚动/点按钮
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
}

function moveDrag(e) {
  if (!dragging) return;
  if (e.pointerId != null && dragging.pointerId != null && e.pointerId !== dragging.pointerId) return;
  const dx = e.clientX - dragging.startX;
  const dy = e.clientY - dragging.startY;
  if (!dragging.moved && Math.abs(dx) + Math.abs(dy) < 8) return;   // 手抖不算拖
  dragging.moved = true;
  dragging.el.classList.add("dragging");
  if (e.cancelable) e.preventDefault();
  const layer = $("tray-layer");
  const pw = paperWidth();
  const maxX = Math.max(0, layer.clientWidth - pw);
  const maxY = Math.max(0, layer.clientHeight - 170);
  dragging.el.style.left = Math.min(maxX, Math.max(0, dragging.originX + dx)) + "px";
  dragging.el.style.top = Math.min(maxY, Math.max(0, dragging.originY + dy)) + "px";
}

function endDrag(cancelled) {
  if (!dragging) return;
  const { item, el, moved } = dragging;
  el.classList.remove("dragging");
  if (moved) {
    item.x = parseInt(el.style.left, 10) || 0;
    item.y = parseInt(el.style.top, 10) || 0;
    socket.emit("updateTrayPos", { uid: item.uid, x: item.x, y: item.y });
    // 拖完顺手把画布撑到能容纳新位置（手机横向滚动也不丢）
    const layer = $("tray-layer");
    const need = item.x + paperWidth() + 24;
    if (need > layer.clientWidth) layer.style.width = need + "px";
  } else if (!cancelled) {
    openZoom(item);                                  // 轻点整张纸条 = 放大阅读
  }
  dragging = null;
}

document.addEventListener("pointermove", moveDrag, { passive: false });
document.addEventListener("pointerup", () => endDrag(false));
document.addEventListener("pointercancel", () => endDrag(true));
window.addEventListener("blur", () => endDrag(true));

/** 系统整理：宽屏 4 列、手机 2 列 */
function arrangeTray() {
  const items = S.tray || [];
  if (!items.length) return toast("托盘还是空的");
  const layer = $("tray-layer");
  const pw = paperWidth();
  const gap = pw + 20;
  const cols = Math.max(1, Math.floor((((layer.parentElement || {}).clientWidth || 1000) - 24) / gap));
  const useCols = cols >= 4 ? 4 : (cols >= 2 ? 2 : 1);
  const positions = items.map((it, i) => ({
    uid: it.uid,
    x: 16 + (i % useCols) * gap,
    y: 16 + Math.floor(i / useCols) * (pw * 0.92)
  }));
  positions.forEach((p, i) => { items[i].x = p.x; items[i].y = p.y; });
  socket.emit("setTrayPositions", { positions });
  toast("已按系统顺序整理托盘");
}

/* 手机横竖屏切换、窗口缩放后重排托盘 */
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (S && S.gameStarted && !dragging && !$("screen-player").classList.contains("hidden")) renderTray();
  }, 180);
});

/** 把线索复印一份给其他玩家（自己托盘里的原件保留，不会消失） */
function tradeItem(item) {
  if (item.kind !== "clue") return toast("只有线索可以分享给其他玩家");
  const others = Object.keys(S.players).filter((n) => n !== S.me.name && ((!S.players[n].isDM) || S.players[n].plays));
  if (!others.length) return toast("房间里还没有其他玩家");
  const pick = others.length === 1 ? others[0] : window.prompt(
    "把「" + item.title + "」分享给谁？\n可选：" + others.join("、"), others[0]
  );
  if (!pick || others.indexOf(pick) === -1) return toast("已取消分享");
  socket.emit("tradeClue", { to: pick, uid: item.uid });
  toast("已发送给 " + pick);
}
/* ---------- 居中弹窗 / 放大阅读 ---------- */
function bindPopups() {
  $("btn-popup-close").onclick = () => $("popup").classList.add("hidden");
  $("btn-popup-tray").onclick = () => {
    $("popup").classList.add("hidden");
    const panel = $("player-lobby");
    if (!$("player-game").classList.contains("hidden")) {
      $("tray-layer").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  $("btn-zoom-close").onclick = () => $("zoom").classList.add("hidden");
  document.querySelectorAll("[data-zoom]").forEach((b) => {
    b.onclick = () => {
      zoomFont = b.dataset.zoom === "plus"
        ? Math.min(30, zoomFont + 2)
        : Math.max(11, zoomFont - 2);
      $("zoom-body").style.fontSize = zoomFont + "px";
    };
  });
  ["popup", "zoom"].forEach((id) => {
    $(id).addEventListener("click", (e) => {
      if (e.target === $(id)) $(id).classList.add("hidden");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("popup").classList.add("hidden");
      $("zoom").classList.add("hidden");
    }
  });
}

function showPopup(p) {
  $("popup-icon").textContent = ICON[p.kind] || "📌";
  $("popup-title").textContent = p.title || "提示";
  $("popup-body").textContent = p.body || "";
  $("popup-hint").textContent = p.hint || "";
  $("btn-popup-tray").classList.toggle("hidden", my.isDM);
  $("popup").classList.remove("hidden");
}

function openZoom(item) {
  if (!item) return;
  zoomItemRef = item;
  zoomFont = 15;
  $("zoom-title").textContent = item.tag + " · " + item.title;
  $("zoom-body").style.fontSize = zoomFont + "px";
  $("zoom-body").textContent = item.full;
  const t = new Date(item.createdAt || Date.now());
  $("zoom-foot").textContent =
    "获得时间：" + t.toLocaleString("zh-CN") + " · 可点 A+ / A− 调整字号";
  $("zoom").classList.remove("hidden");
}

/* ---------- 工具 ---------- */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
