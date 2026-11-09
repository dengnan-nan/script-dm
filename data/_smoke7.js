const fs = require("fs");
const { io } = require("socket.io-client");
const S = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(" PASS", m); } else { fail++; console.log(" FAIL", m); } };

(async () => {
  const r = await fetch(S + "/api/parse", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: [{ name: "6人.docx", data: fs.readFileSync("C:/Users/dell/Desktop/6人.docx").toString("base64") }] })
  });
  const parsed = (await r.json()).script;

  const dm = io(S, { transports: ["websocket"] });
  let rid = "";
  await new Promise((res) => dm.on("connect", res));
  const createdP = new Promise((res) => dm.once("created", (d) => { rid = d.roomId; res(); }));
  dm.emit("createRoom", { name: "DM-A", script: parsed });
  await createdP;
  dm.emit("join", { roomId: rid, name: "DM-A", isDM: true, plays: false });
  await sleep(400);

  const p1 = io(S, { transports: ["websocket"] });
  const p2 = io(S, { transports: ["websocket"] });
  let s1 = null, s2 = null, note1 = null, note2 = null, taskNote = null;
  p1.on("state", (s) => { s1 = s; });
  p2.on("state", (s) => { s2 = s; });
  p1.on("notify", (n) => { note1 = n; if (n.kind === "task") taskNote = n; });
  p2.on("notify", (n) => { note2 = n; });
  await new Promise((r2) => p1.on("connect", r2));
  await new Promise((r2) => p2.on("connect", r2));
  p1.emit("join", { roomId: rid, name: "玩家甲", isDM: false });
  p2.emit("join", { roomId: rid, name: "玩家乙", isDM: false });
  await sleep(400);
  p1.emit("pickRole", { roleId: "r1" });
  p2.emit("pickRole", { roleId: "r2" });
  await sleep(300);

  dm.emit("startGame");
  await sleep(800);
  dm.emit("pushAct", { idx: 0 });
  await sleep(600);

  ok(!!rid, "建房成功 " + rid);
  ok(s1 && s1.game.name === "晚星宿舍楼", "房间剧本名：" + (s1 && s1.game.name));
  ok(s1 && s1.game.roles.length === 6, "玩家看到 6 个角色");
  ok(s1 && s1.game.acts.length === 3, "玩家看到 3 幕");
  console.log("NOTE1:", JSON.stringify({ t: note1 && note1.title, b: (note1 && note1.body || "").slice(0, 80) }));
  ok(!!taskNote && /人物档案/.test(taskNote.body || "") && /【你的任务】/.test(taskNote.body || ""), "开本下发人物档案+任务（" + (taskNote && taskNote.title) + "）");
  ok(!!taskNote && /沈知予/.test(taskNote.body || "") && /霸凌/.test(taskNote.body || ""), "档案里带了本人秘密（别人看不到）");

  // 推第 2 幕，看个人视角
  let n2 = null;
  p1.on("notify", (n) => { if (n.kind === "script") n2 = n; });
  dm.emit("pushAct", { idx: 1 });
  await sleep(600);
  ok(!!n2 && /这一幕你的处境/.test(n2.body || ""), "第 2 幕下发个人视角");
  console.log("NOTE2:", JSON.stringify({ t: n2 && n2.title, b: (n2 && n2.body || "").slice(0, 60) }));
  ok(!!n2 && /墙中低语/.test(n2.body || ""), "第 2 幕正文含「墙中低语」");
  ok(!!n2 && !/唐乐|林薇薇/.test((n2.body || "").split("【你的剧本")[0]), "公共段落没有混入别人的秘密");

  ok(parsed.acts[0].clues.length === 8, "第 1 幕 8 条线索");
  ok(parsed.roles.find((x) => x.name === "周诚").isKiller === true, "真凶周诚已标记");

  console.log("结果：PASS " + pass + " / FAIL " + fail);
  process.exit(fail ? 1 : 0);
})();
