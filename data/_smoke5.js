const { io } = require("socket.io-client");
const URL = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS " + m)) : (fail++, console.log("  FAIL " + m)); };
const post = async (p, body) => (await fetch(URL + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();

(async () => {
  // ---------- 自动生成 ----------
  const lib = await (await fetch(URL + "/api/library")).json();
  ok((lib.styles || []).length >= 4, "风格选项：" + (lib.styles || []).map(s => s.label).join("/"));

  const gen = await post("/api/generate", { count: 5, style: "ancient", title: "长安夜宴测试" });
  const sc = gen.script || {};
  ok(sc.roles && sc.roles.length === 5, "生成 5 个角色");
  ok(sc.acts && sc.acts.length === 3, "生成 3 幕");
  ok(sc.roles.filter(r => r.isKiller).length === 1, "恰好一个真凶");
  ok(sc.acts.every(a => Object.keys(a.personal || {}).length === 5), "每一幕每人都有个人视角");
  ok(sc.acts.every(a => a.clues.length >= 3), "每幕至少 3 条线索（公开 + 私人）");
  ok(sc.roles.every(r => r.desc.includes("身份：") && r.desc.includes("不愿说的事：")), "每人都有完整人物资料");
  ok(sc.roles.every(r => r.tasks.length >= 3), "每人都有任务");
  ok(!!sc.reveal && sc.reveal.includes(sc.roles.find(r => r.isKiller).name), "复盘里写明真凶");
  ok(!sc.hints["1"].includes(sc.roles.find(r => r.isKiller).name), "扶车提示不写凶手名字");

  // 人数下限/上限
  const bad = await post("/api/generate", { count: 9, style: "night" });
  ok(!!bad.error, "人数越界会报错：" + bad.error);

  // ---------- 用生成的剧本开房 ----------
  const dm = io(URL, { transports: ["websocket"] });
  const p1 = io(URL, { transports: ["websocket"] });
  let sd = null, sp = null;
  const notifies = [];
  dm.on("state", s => sd = s);
  p1.on("state", s => sp = s);
  p1.on("notify", n => notifies.push(n));
  await sleep(120);
  dm.emit("createRoom", { name: "DM-测", script: gen.script });
  const created = await new Promise(r => dm.once("created", r));
  dm.emit("join", { roomId: created.roomId, name: "DM-测", isDM: true, plays: false });
  p1.emit("join", { roomId: created.roomId, name: "玩家甲", isDM: false });
  await sleep(350);
  ok(sd.game.name === "长安夜宴测试", "房间用的是生成的本");
  p1.emit("pickRole", { roleId: "r1" });
  await sleep(250);
  dm.emit("startGame", {});
  await sleep(500);
  ok(sp.gameStarted && sp.currentAct === 0, "开本后进入第一幕");
  const docNote = notifies.find(n => n.kind === "task");
  ok(!!docNote && docNote.body.includes("身份："), "开本时把人物资料发给了玩家");
  ok(!!docNote && docNote.body.includes("你的任务"), "人物资料里带任务");
  const actNote = notifies.find(n => n.kind === "script");
  ok(!!actNote && actNote.title.includes("新一轮开始"), "第一幕通知写明「新一轮开始」：" + (actNote || {}).title);

  // ---------- 时间间隔 + 倒计时 ----------
  ok(!!sd.autoTiming, "中控台能拿到当前节奏参数：" + JSON.stringify(sd.autoTiming));
  ok(!!sd.autoNext && typeof sd.autoNext.at === "number", "有倒计时数据（下一步：" + (sd.autoNext || {}).label + "）");
  dm.emit("setTiming", { clueDelay: 2, clueGap: 2, actGap: 5, voteDelay: 5 });
  await sleep(400);
  ok(sd.autoTiming.actGap === 5 && sd.autoTiming.clueDelay === 2, "节奏参数已保存并下发");
  const label1 = (sd.autoNext || {}).label || "";
  ok(label1.includes("第 2 幕"), "倒计时指向下一幕：" + label1);
  const left1 = sd.autoNext.at - Date.now();
  await sleep(1200);
  const left2 = sd.autoNext ? sd.autoNext.at - Date.now() : -1;
  ok(left2 < left1, "倒计时在走：" + Math.round(left1) + "ms → " + Math.round(left2) + "ms");

  // 到点自动切幕
  await sleep(4500);
  ok(sd.currentAct === 1, "到时间 AutodDm 自动推送了第 2 幕（currentAct=" + sd.currentAct + "）");
  ok((sd.autoNext || {}).label && sd.autoNext.label.includes("线索"), "切幕后倒计时转成发线索：" + (sd.autoNext || {}).label);

  // 人工介入后倒计时消失
  dm.emit("setAuto", { auto: false });
  await sleep(300);
  ok(!sd.autoNext, "切人工后不再显示倒计时");

  console.log("\n结果：PASS " + pass + " / FAIL " + fail);
  dm.close(); p1.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("异常", e); process.exit(2); });
