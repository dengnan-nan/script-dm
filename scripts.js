/* 剧本库 + 文本解析（Word / txt / md / 链接）
 * 只在本机运行，不依赖外部服务。
 */
const zlib = require("zlib");
const parseReal = require("./parse");

/* ---------------------------------------------------------------- 工具 */
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad2 = (n) => String(n).padStart(2, "0");

function themeOf(text) {
  const t = String(text || "");
  if (/恐怖|尸|鬼|病院|病房|血|尖叫|灵异|凶宅/.test(t)) return "horror";
  if (/古风|宫|皇帝|娘娘|江湖|侠|王朝|府|宴/.test(t)) return "ancient";
  if (/校园|学校|教室|同学|青春|毕业|社团|校服/.test(t)) return "campus";
  if (/雨|夜|悬疑|推理|警|案|尸检|失踪/.test(t)) return "night";
  return "paper";
}

/* ---------------------------------------------------------------- 内置剧本库 */
const LIBRARY = [
  {
    id: "rain-house",
    name: "雨夜旧屋",
    type: "硬核推理",
    theme: "night",
    intro: "五年前的雨夜，旧屋主人离奇死亡。今夜，四个人被同一封匿名信召集回这里。",
    roles: [
      { id: "r1", name: "苏晚", avatar: "🌂", desc: "旧屋主人的远房侄女，安静内敛，对这座房子格外熟悉。", tasks: ["找出杀害伯父的真凶", "隐瞒今夜翻找保险柜的行为"] },
      { id: "r2", name: "林默", avatar: "🔧", desc: "沉默寡言的修理工，近半年频繁出入这片老街区。", tasks: ["隐藏自己与死者的真实关系", "销毁留有自己签名的单据"], isKiller: true },
      { id: "r3", name: "陈舟", avatar: "🕵️", desc: "受托而来的调查员，随身带着一只旧相机。", tasks: ["锁定真凶", "还原五年前的时间线"] },
      { id: "r4", name: "周野", avatar: "📻", desc: "旧屋从前的租客，今晚带着一台老式录音机。", tasks: ["查明录音带里被剪掉的那一段"] }
    ],
    acts: [
      {
        title: "第一幕 · 雨夜集结",
        public: "暴雨倾盆，你们先后抵达这栋老屋。客厅的灯忽明忽暗，桌上摆着四封一模一样的匿名信，信里只有一句话：还记得五年前那个雨夜吗？",
        personal: {
          r1: "你从小在这栋房子里长大。伯父死后房子一直空着，今晚玄关的伞架上却多了一把滴水的黑伞——不是你的。",
          r2: "你比约定时间早到了一小时。离开时工具箱少了一把螺丝刀，而你还没打开过它。",
          r3: "委托人只留下一个地址和一句嘱托：别相信任何人。你在门口捡到半张被雨水泡开的收据。",
          r4: "你曾是这里的租客，五年前的那个雨夜你也在场，但你对警方说的是另一套说辞。"
        },
        clues: [
          { id: "C001", title: "匿名信", content: "四封信字迹完全相同，纸张来自镇上唯一一家文具店。信封背面有一处被雨水晕开的指纹。", to: "all", isPublic: true },
          { id: "C002", title: "滴水的黑伞", content: "伞骨内侧粘着一小片机油，伞柄刻着一个被磨掉的字母，像是“L”。", to: "r1" },
          { id: "C003", title: "半张收据", content: "收据上是五年前的日期，金额与一次房屋修缮工程吻合，签名处被撕掉。", to: "r3" }
        ]
      },
      {
        title: "第二幕 · 旧物",
        public: "雨声渐小。你们决定分头检查这栋房子：阁楼、书房、地下室，还有那台一直没关的收音机。",
        personal: {
          r1: "你打开了保险柜，里面只剩一个空信封。收信人一栏被指甲刮掉了。",
          r2: "你发现工具箱里的单据不见了。有人在你去客厅之前动过它。",
          r3: "你把半张收据和修缮合同对照，合同上的施工方负责人姓林。",
          r4: "你按下录音机的播放键，磁带里有一段被人剪掉的空白，恰好是五年前那个雨夜的晚上十点。"
        },
        clues: [
          { id: "C004", title: "修缮合同", content: "五年前的修缮工程由“林记五金”承接，合同末页有施工方签字：林默。", to: "all", isPublic: true },
          { id: "C005", title: "空信封", content: "保险柜里的信封已经空了，邮戳显示寄出日期是案发前一周。", to: "r1" },
          { id: "C006", title: "剪掉的磁带", content: "磁带在晚十点整有一段约三分钟的空白，空白前后能听见同一个人的呼吸声。", to: "r4" }
        ]
      },
      {
        title: "第三幕 · 对质",
        public: "凌晨两点，雨停了。所有的谎言都被摆在桌上，现在只剩最后一个问题：五年前那个雨夜，究竟是谁动的手？",
        personal: {
          r1: "你终于想起，那个雨夜你看见有人从后门离开，手里提着一只工具箱。",
          r2: "你的手套内侧还留着机油味，你知道今晚之后再也瞒不住了。",
          r3: "把所有证据连起来，答案其实只有一个。你要做的是让别人也相信。",
          r4: "录音带里被剪掉的三分钟，你其实听过完整版。"
        },
        clues: [
          { id: "C007", title: "后门的脚印", content: "泥地上有一串被雨水冲淡的鞋印，鞋码与在场某人一致，方向指向屋后的工具间。", to: "all", isPublic: true },
          { id: "C008", title: "工具间的灯", content: "工具间灯泡还是温的，说明一小时之内有人来过；地上有新鲜的金属屑。", to: "r2" }
        ]
      }
    ],
    ending: {
      trueEnd: "真凶是林默。五年前那场“意外死亡”，是他在修缮工程中动的手；今夜他回到旧屋，是为了拿回唯一能指认自己的单据。",
      falseEnd: "你们投错了人。真正的凶手趁着夜色收拾好工具箱，从后门离开了旧屋——这一局，真相被雨声盖了过去。"
    },
    reveal: "完整复盘：\n\n1. 五年前，林默以“林记五金”的名义承接旧屋修缮工程，与屋主发生款项纠纷。\n2. 案发当晚十点，两人在工具间争执，林默行凶后从后门离开。\n3. 他留下了带签名的修缮单据，这是唯一能把“林记五金”与屋主死亡直接关联的证据。\n4. 五年后他收到匿名信，误以为有人掌握证据，于是回到旧屋销毁单据。\n5. 关键线索：C002 黑伞、C004 修缮合同、C008 工具间的灯。",
    hints: {
      1: "轻推一下：先别急着指认人。把“谁今晚来过这栋房子、谁身上带着不属于自己的东西”这两件事列出来。",
      2: "中推：五年前的旧账和今晚的异样是同一件事。找一件能同时说明时间、钱、人的物件。",
      3: "强推：注意每个人“为什么要回来”。有人回来不是为了叙旧，而是为了带走一样东西；谁最怕它被留下？"
    },
    autoTiming: { clueDelay: 480, clueGap: 180, actGap: 1800, voteDelay: 600 }
  },
  {
    id: "cicada",
    name: "蝉鸣未歇",
    type: "校园情感",
    theme: "campus",
    intro: "高三最后一个夏天，四个人在同一间教室里补课。有人把一封没署名的信塞进了窗台的绿萝盆里。",
    roles: [
      { id: "r1", name: "许知夏", avatar: "🌿", desc: "班里的学习委员，安静但记性极好，抽屉里收着所有人的错题本。", tasks: ["找出信是谁写的", "隐瞒自己那晚翻过别人书包"] },
      { id: "r2", name: "陆行", avatar: "🏀", desc: "篮球队队长，成绩中等，最近总在放学后一个人留在球场。", tasks: ["保护一个人的秘密", "解释清楚自己手上的伤"], isKiller: true },
      { id: "r3", name: "江迟", avatar: "🎧", desc: "转学生，戴着耳机不说话，却记得每个人的生日。", tasks: ["还原那封信的来路"] },
      { id: "r4", name: "温宁", avatar: "📷", desc: "校刊摄影，喜欢拍空教室和晚霞，相机里有一卷没洗的胶卷。", tasks: ["查明胶卷里被曝光掉的那几张"] }
    ],
    acts: [
      {
        title: "第一幕 · 蝉声里的信",
        public: "六月的教室闷热，蝉在窗外叫个不停。窗台上那盆绿萝被人翻过土，一封没有署名的信露出半截。信上只有一句：那天晚上，我看见了。",
        personal: {
          r1: "你整理错题本时发现少了一本，封面写着一个人的名字。你不确定是不是自己放错了。",
          r2: "你手上的伤是被铁丝网刮的，但你不希望任何人知道那晚你翻墙回来过。",
          r3: "你认得那封信的纸——和你在转学第一天收到的那张匿名欢迎卡一模一样。",
          r4: "你拍过一张空教室的照片，冲洗出来时发现多了一个不该出现在画面里的影子。"
        },
        clues: [
          { id: "C001", title: "没署名的信", content: "信纸是从校刊稿纸撕下来的，边缘有整齐的撕痕；墨水是蓝黑的，和教室里公用钢笔一致。", to: "all", isPublic: true },
          { id: "C002", title: "少掉的错题本", content: "缺页的位置正好是某个人的签名页，剩下的纸上有淡淡的铅笔压痕，能看清“陆”字的一半。", to: "r1" },
          { id: "C003", title: "铁丝网的划痕", content: "操场东侧铁丝网有一处新断口，高度约在一米二，旁边草丛里捡到一根断掉的鞋带。", to: "r2" }
        ]
      },
      {
        title: "第二幕 · 曝光的那几张",
        public: "晚自习后，四个人留在空教室里冲洗胶卷。红灯下，照片一张张显影，画面里出现了所有人都没注意到的细节。",
        personal: {
          r1: "你终于承认，那晚你回过教室，是为了把一本错题本放回原处。",
          r2: "照片里你的鞋和铁丝网下的鞋带对得上，你知道自己再也说不清了。",
          r3: "你想起转学那天，唯一对你好的人是谁。你开始怀疑这封信是写给谁看的。",
          r4: "被曝光掉的那几张，其实你都留了底片。"
        },
        clues: [
          { id: "C004", title: "显影盘里的照片", content: "照片拍的是空教室，但窗台绿萝的影子旁边多了一双鞋，鞋带少了一根。", to: "all", isPublic: true },
          { id: "C005", title: "蓝黑墨水的钢笔", content: "教室公用钢笔的笔尖有轻微弯折，写字时会留下独有的顿笔，和信上的笔迹吻合。", to: "r3" },
          { id: "C006", title: "留了底片的胶卷", content: "底片最后三格被人为曝光，但边缘的齿孔附近还能看到一小块校服袖口的颜色。", to: "r4" }
        ]
      }
    ],
    ending: {
      trueEnd: "写那封信的人是陆行。他不是在揭发别人，而是在替一个不敢开口的人说话——那晚翻墙回来的人，其实是他自己。",
      falseEnd: "你们把信当成了指控，却漏掉了写信人的心意。夏天结束了，那句话始终没有被说出口。"
    },
    reveal: "完整复盘：\n\n1. 信纸来自校刊稿纸，只有校刊组的人能随手拿到，陆行长期帮校刊搬器材。\n2. “那天晚上，我看见了”里的“看见”，指的不是偷东西，而是看见了某个人在操场独自哭。\n3. 铁丝网的断口与鞋带说明有人翻墙回校，那个人是陆行，他回来是为了把那本错题本放回原处。\n4. 关键线索：C002 错题本、C003 划痕、C004 照片。",
    hints: {
      1: "轻推：先分清“这封信是在揭发谁”，还是“在替谁说话”。写信的人未必是受害者。",
      2: "中推：把纸的来源、笔迹、以及谁有理由深夜回到教室这三件事串起来。",
      3: "强推：注意那句“我看见了”后面没有宾语。真正的答案，藏在照片里那双少了一根鞋带的鞋上。"
    },
    autoTiming: { clueDelay: 480, clueGap: 180, actGap: 1500, voteDelay: 540 }
  },
  {
    id: "palace",
    name: "长夜宫宴",
    type: "古风权谋",
    theme: "ancient",
    intro: "王朝末年，一场为太后贺寿的宫宴。烛火通明之下，三位贵人各怀心事，御膳房的一只银碗不翼而飞。",
    roles: [
      { id: "r1", name: "沈昭仪", avatar: "🪷", desc: "入宫三年，最得太后欢心，也最懂什么时候不说话。", tasks: ["保住自己的位置", "掩盖那封送不出去的家书"] },
      { id: "r2", name: "裴侍郎", avatar: "🗡️", desc: "掌管内廷宿卫，今夜宫门由他落锁。", tasks: ["查清银碗去向", "隐瞒换岗的时辰"], isKiller: true },
      { id: "r3", name: "崔尚食", avatar: "🍶", desc: "御膳房掌事，宴上每一道菜都要经她的手。", tasks: ["证明自己的清白", "找回被调换的食谱"] },
      { id: "r4", name: "小李子", avatar: "🕯️", desc: "太后身边的内侍，耳朵最灵，嘴最紧。", tasks: ["弄明白谁在夜里出过宫门"] }
    ],
    acts: [
      {
        title: "第一幕 · 烛影里的银碗",
        public: "戌时三刻，宴席正酣。御膳房呈上的银碗少了一只，太后只说了一句“今夜风大”，便让众人各自回席。宫墙上的灯笼被风吹得东倒西歪。",
        personal: {
          r1: "你袖中有一封未送出的家书，落款处被烛泪烫出一个小洞。你不确定有没有人看见。",
          r2: "今夜你临时换了岗，换岗的时辰没有记进册子。你知道这件事经不起查。",
          r3: "食谱少了一页，正是那道银碗盛的羹。你记得那一页上原本写着一味不该出现的药。",
          r4: "你听见御膳房后门有落锁声，比平日早了半刻。"
        },
        clues: [
          { id: "C001", title: "少了一页的食谱", content: "食谱缺页处残留着药渣印痕，边角写着“安”字，与寻常羹汤用料不符。", to: "all", isPublic: true },
          { id: "C002", title: "被烛泪烫过的信", content: "信纸上写着“若我不归，请照看西院”，落款处被烫穿，只剩半个姓。", to: "r1" },
          { id: "C003", title: "换岗册", content: "今夜宿卫册上有一处墨迹被刮改，改动的时辰恰好覆盖了宴席后半段。", to: "r2" }
        ]
      },
      {
        title: "第二幕 · 宫门落锁",
        public: "亥时，宫门落锁。风停了，廊下的灯笼一盏盏熄下去。有人在后厨的水缸边发现了一只洗净的银碗，碗底刻着一行小字。",
        personal: {
          r1: "你终于明白，那封家书不是写给家人的，而是写给一个还在宫里的人。",
          r2: "你换岗不是为了私事，而是为了送一个人出宫。可那个人没有出现。",
          r3: "你想起来了：那味药不该出现在太后的羹里，而食谱上原本写的是另一个人的名字。",
          r4: "你在后门捡到一枚腰牌，牌上的名字被人用刀划掉了。"
        },
        clues: [
          { id: "C004", title: "碗底的小字", content: "银碗底部刻着“长夜”二字，是内廷旧制的记年法，对应十年前的一桩旧案。", to: "all", isPublic: true },
          { id: "C005", title: "被划掉的腰牌", content: "腰牌是宿卫处的样式，划痕新鲜，牌绳上还带着一点药味。", to: "r4" },
          { id: "C006", title: "后厨的水迹", content: "水缸边有一串脚印，鞋底纹样是内廷当值靴，尺码与某位大人一致。", to: "r3" }
        ]
      }
    ],
    ending: {
      trueEnd: "银碗是裴侍郎拿走的。十年前那桩旧案里，他的家人正是被那只碗里的药送走的；今夜他换岗，是想让同样的药出现在太后的席上。",
      falseEnd: "你们在宫墙里绕了一夜。真正的答案被锁进宫门，随着落锁声一起沉下去了。"
    },
    reveal: "完整复盘：\n\n1. 食谱缺页对应十年前的一味药，那味药曾出现在旧案里。\n2. 裴侍郎临时换岗，掩盖了自己进入后厨的时辰。\n3. 银碗被洗净放回，是为了让人以为它只是“不小心落下”，碗底的字是他故意留下的。\n4. 关键线索：C001 食谱、C003 换岗册、C004 碗底小字。",
    hints: {
      1: "轻推：宫里的物件都有规矩。先看哪一样东西“不该出现在它该在的地方”。",
      2: "中推：十年前的旧事和今夜的宴席用的是同一样东西。查食谱，查时辰。",
      3: "强推：有人换岗不是失职，是为了让某个人在某个时刻不被看见。谁最需要一个空档？"
    },
    autoTiming: { clueDelay: 540, clueGap: 240, actGap: 1800, voteDelay: 600 }
  },
  {
    id: "ward7",
    name: "第七间病房",
    type: "恐怖还愿",
    theme: "horror",
    intro: "城郊的老疗养院只剩三位值夜的人。凌晨三点，护士站的呼叫灯亮了——来自第七间病房，而那间病房已经空了七年。",
    roles: [
      { id: "r1", name: "顾护士", avatar: "💉", desc: "值夜第三年，熟悉每一条走廊，却从不走第七间那一段。", tasks: ["撑到天亮", "隐瞒自己改过的值班表"] },
      { id: "r2", name: "老韩", avatar: "🔦", desc: "守夜人，手电筒从不离手，说这楼里“有些东西不归他管”。", tasks: ["查清呼叫灯为什么亮"], isKiller: true },
      { id: "r3", name: "沈医生", avatar: "📋", desc: "临时来代班，病历写得一丝不苟，却对七年前的事一无所知。", tasks: ["还原七年前那晚的病历"] }
    ],
    acts: [
      {
        title: "第一幕 · 三点零七分",
        public: "呼叫灯亮了三次，每次都是三点零七分。走廊尽头的第七间病房门锁着，门缝下透出一点光，像有人在里面走动。",
        personal: {
          r1: "你改过值班表，把某个人的名字划掉了。你不想再有人去那一段走廊。",
          r2: "你手里有一把不该存在的钥匙，牌子上写着 7。",
          r3: "病历本上七年前那一页被整齐撕走，剩下的纸边留着圆珠笔的压痕。"
        },
        clues: [
          { id: "C001", title: "三点零七分", content: "呼叫记录打印纸上，三次呼叫的时间完全一致，间隔精确到秒，不像人手按出来的。", to: "all", isPublic: true },
          { id: "C002", title: "被划掉的名字", content: "值班表上用修正液盖过一个名字，对着灯能看到底下的姓氏和七年前的日期。", to: "r1" },
          { id: "C003", title: "7 号钥匙", content: "钥匙齿口很新，但牌子是旧的。第七间病房七年前就换了锁。", to: "r2" }
        ]
      },
      {
        title: "第二幕 · 门后的光",
        public: "门开了。房间里没有人，只有一张床，床单平整得像刚铺好。墙上挂着的日历停在七年前的今天。",
        personal: {
          r1: "你终于想起，七年前那个夜班，是你最后一次见到那个人。",
          r2: "钥匙是你留下的。你每年这一天都会来开一次门。",
          r3: "病历的压痕告诉你：那一页写的不是病情，而是一个人的名字。"
        },
        clues: [
          { id: "C004", title: "停住的日历", content: "日历停在七年前的今天，纸页边缘有反复翻动的旧痕，说明有人每年都来翻到这一页。", to: "all", isPublic: true },
          { id: "C005", title: "平整的床单", content: "床单上有淡淡消毒水味，枕头凹陷的形状说明有人长时间坐在床边。", to: "r3" },
          { id: "C006", title: "钥匙上的刻字", content: "钥匙柄内侧刻着一个日期和两个字母缩写，缩写与院里的某位工作人员一致。", to: "r2" }
        ]
      }
    ],
    ending: {
      trueEnd: "七年来的呼叫不是鬼，是老韩。他每年这一天开门，按三次呼叫灯，替那个死在第七间病房的人“报一次到”。",
      falseEnd: "你们逃出了走廊，却没人再敢提起第七间病房。灯还亮着，三点零七分。"
    },
    reveal: "完整复盘：\n\n1. 呼叫灯是老韩手动按的，他保留了 7 号钥匙。\n2. 值班表被改，是因为顾护士不想让新人被排到那一段走廊。\n3. 病历被撕走，是为了藏起死者的名字；沈医生凭压痕还原了这一页。\n4. 关键线索：C002 值班表、C003 钥匙、C004 日历。",
    hints: {
      1: "轻推：先分清“有人装神”还是“真有事”。看看哪些痕迹是新的，哪些是旧的。",
      2: "中推：三样东西都指向同一个年份。谁有钥匙，谁能改表，谁每年都来？",
      3: "强推：呼叫灯亮得太准时了。人手按不出秒级的一致——但也未必是鬼在按。谁最需要它每年亮一次？"
    },
    autoTiming: { clueDelay: 480, clueGap: 180, actGap: 1620, voteDelay: 570 }
  }
];

function defaultScript() { return clone(LIBRARY[0]); }
function getLibrary() { return LIBRARY.map((s) => ({
  id: s.id, name: s.name, type: s.type, theme: s.theme, intro: s.intro,
  roles: s.roles.length, acts: s.acts.length
})); }
function getLibraryScript(id) {
  const s = LIBRARY.find((x) => x.id === id);
  return s ? clone(s) : null;
}

/* ---------------------------------------------------------------- docx 解包 */
/** 读取 zip 中央目录，取指定条目并 raw inflate（纯 zlib，无需第三方包） */
function readZipEntry(buf, wantName) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 docx（找不到 zip 目录）");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    if (name === wantName || name.endsWith("/" + wantName) || name.endsWith(wantName)) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataStart, dataStart + compSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decodeEntities = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));

function docxToText(buf) {
  if (!buf || !buf.length) throw new Error("空文件");
  const magic = buf.subarray(0, 8).toString("hex").toUpperCase();

  // ① 正常 docx（zip）
  if (buf.subarray(0, 2).toString() === "PK") {
    const xml = readZipEntry(buf, "word/document.xml");
    if (!xml) throw new Error("这个 docx 里没有正文（可能只有图片或表格）");
    let s = xml.toString("utf8");
    s = s.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<w:cr\/>/g, "\n");
    s = s.replace(/<\/w:p>/g, "\n");
    s = s.replace(/<[^>]+>/g, "");
    return decodeEntities(s).replace(/\n{3,}/g, "\n\n").trim();
  }

  // ② 老版 .doc / WPS 二进制（OLE 复合文档，扩展名被改成了 docx）
  if (magic.startsWith("D0CF11E0")) {
    const e = new Error("这是老版 .doc（或 WPS 二进制文档），不是真正的 .docx");
    e.code = "OLD_DOC";
    e.buffer = buf;
    throw e;
  }

  // ③ 其实是纯文本（有人把 txt/md 改成了 .docx）
  const txt = decodeAnyText(buf);
  if (looksLikeText(txt)) return txt.replace(/\n{3,}/g, "\n\n").trim();

  throw new Error("无法识别的文件格式（不是 docx、不是 doc、也不是文本）");
}

/** 粗判一段文本像不像「人写的正文」，避免把二进制当文本吃进来 */
function looksLikeText(t) {
  if (!t || !/\S/.test(t)) return false;
  const sample = t.slice(0, 4000);
  const bad = (sample.match(/[\u0000-\u0008\u000e-\u001f\uFFFD]/g) || []).length;
  if (bad > sample.length * 0.02) return false;
  const cjk = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
  return cjk >= 10 || /\n/.test(sample);
}

/** 文本编码兜底：UTF-8(带/不带 BOM) → GB18030 */
function decodeAnyText(buf) {
  const b = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(b);
    if (s && !/\uFFFD/.test(s)) return s;
  } catch (e) { /* 继续试 GBK */ }
  try { return new TextDecoder("gb18030").decode(buf); } catch (e) { return ""; }
}

/** 老版 .doc / WPS 二进制：借本机 WPS 或 Word 转一次纯文本（只读打开、不弹窗） */
function oldDocToText(buf) {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");
  const { execFileSync } = require("child_process");
  const dir = path.join(os.tmpdir(), "dm-doc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, "in.doc");
  const dst = path.join(dir, "out.txt");
  fs.writeFileSync(src, buf);
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$in=$env:DM_IN; $out=$env:DM_OUT",
    "$app=$null",
    "try { $app=New-Object -ComObject KWps.Application } catch { $app=New-Object -ComObject Word.Application }",
    "try { $app.Visible=$false } catch {}",
    "try { $app.DisplayAlerts=0 } catch {}",
    "$doc=$app.Documents.Open($in,$false,$true)",
    "$doc.SaveAs2($out,7)",
    "$doc.Close(0)",
    "$app.Quit()"
  ].join("; ");
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      timeout: 60000, stdio: "ignore", env: Object.assign({}, process.env, { DM_IN: src, DM_OUT: dst })
    });
    if (!fs.existsSync(dst)) throw new Error("转换没有生成文本");
    const raw = fs.readFileSync(dst);
    const txt = decodeAnyText(raw) || raw.toString("utf8");
    if (!txt.trim()) throw new Error("转换出来的文本是空的");
    return txt.replace(/\r\n?/g, "\n").trim();
  } catch (e) {
    throw new Error("老版 .doc 需要本机 WPS/Word 转换，转换失败：" + (e.message || e));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}


/* ---------------------------------------------------------------- 文本解析 */
const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const actNo = (s) => {
  if (/^\d+$/.test(s)) return Number(s);
  let n = 0;
  for (const ch of s) n = n * 10 + (CN_NUM[ch] || 0);
  return n || 0;
};

function parseTextToScript(rawText, fileName) {
  return parseReal.parseScript(rawText, fileName);
}


const gen = require("./generate");

module.exports = {
  LIBRARY, defaultScript, getLibrary, getLibraryScript, docxToText, oldDocToText, decodeAnyText,
  parseTextToScript, themeOf, clone,
  GEN_STYLES: gen.GEN_STYLES, generateScript: gen.generateScript
};
