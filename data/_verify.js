const fs=require("fs");
const html=fs.readFileSync("public/index.html","utf8");
const js=fs.readFileSync("public/client.js","utf8");
const css=fs.readFileSync("public/style.css","utf8");
console.log("CSS 花括号",(css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
const ids=[...new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]))];
const dyn=["btn-clear-script","btn-use-script","pick-theme"];
const miss=ids.filter(id=>!html.includes('id="'+id+'"')&&!dyn.includes(id));
console.log("id 引用",ids.length,"缺失:",miss.join(",")||"无");
const set=new Set();
[html,js].forEach(src=>{
  src.replace(/class="([^"]+)"/g,(m,g)=>{g.split(/\s+/).filter(Boolean).forEach(c=>{if(!c.includes("$")&&!c.includes("{")&&!c.includes("}"))set.add(c)});return m});
});
const missing=[...set].filter(c=>!new RegExp("\\."+c+"\\b").test(css));
console.log("class 数",set.size,"无样式:",missing.join(",")||"无");
