const { io } = require("socket.io-client");
const URL = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  PASS " + m)) : (fail++, console.log("  FAIL " + m)); };

(async () => {
  // 内置本的默认节奏应该是「分钟级」（>= 300 秒）—— 直接读模块
  const T0 = require("../scripts").getLibraryScript("rain-house").autoTiming;
  ok(T0.clueDelay >= 300 && T0.actGap >= 900, "内置本默认节奏是分钟级：" + JSON.stringify(T0));

  const gen = await (await fetch(URL + "/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 4, style: "ancient" }) })).json();
  ok(gen.script.autoTiming.actGap >= 900, "生成的本默认每一幕 30 分钟：" + JSON.stringify(gen.script.autoTiming));

  const dm = io(URL, { transports: ["websocket"] });
  const p1 = io(URL, { transports: ["websocket"] });
  let sd = null, sp = null;
  dm.on("state", s => sd = s);
  p1.on("state", s => sp = s);
  await sleep(100);
  dm.emit("createRoom", { name: "DM", script: gen.script });
  const created = await new Promise(r => dm.once("created", r));
  dm.emit("join", { roomId: created.roomId, name: "DM", isDM: true, plays: false });
  p1.emit("join", { roomId: created.roomId, name: "甲", isDM: false });
  await sleep(300);
  p1.emit("pickRole", { roleId: "r1" });
  await sleep(200);
  dm.emit("startGame", {});
  await sleep(400);
  ok(sd.autoTiming.actGap === 1800, "开本后下发的是 30 分钟（1800 秒）");

  // 界面按分钟填 → 120 / 60 / 60 / 60 秒
  dm.emit("setTiming", { clueDelay: 120, clueGap: 60, actGap: 60, voteDelay: 60 });
  await sleep(350);
  ok(sd.autoTiming.clueDelay === 120 && sd.autoTiming.actGap === 60, "2 分钟 / 1 分钟 已保存：" + JSON.stringify(sd.autoTiming));

  // 越界收敛：填 0 / 负数回落默认值，不会把节奏搞乱
  dm.emit("setTiming", { clueDelay: 0, clueGap: -5, actGap: 0, voteDelay: 0 });
  await sleep(300);
  ok(sd.autoTiming.clueDelay === 600 && sd.autoTiming.actGap === 1800, "填 0/负数回落到默认节奏：" + JSON.stringify(sd.autoTiming));

  // 再设回 1 分钟，等它真的自动切幕
  dm.emit("setTiming", { clueDelay: 120, clueGap: 60, actGap: 60, voteDelay: 60 });
  await sleep(300);
  const left = sd.autoNext ? sd.autoNext.at - Date.now() : -1;
  ok(left > 50000 && left < 70000, "倒计时约 1 分钟：" + Math.round(left) + "ms");
  await sleep(63000);
  ok(sd.currentAct === 1, "到 1 分钟自动切到第 2 幕（currentAct=" + sd.currentAct + "）");

  console.log("\n结果：PASS " + pass + " / FAIL " + fail);
  dm.close(); p1.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("异常", e); process.exit(2); });
