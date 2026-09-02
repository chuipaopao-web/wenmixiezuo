// GLM-5.3 思考行为探针（第85批预实验）
// 只读环境变量中的 key，绝不打印 key 本身；只输出统计信息。
// 用法: node wenmi-glm-probe.mjs <A|B>
//   A = 不发 thinking 字段（现行直出路由）+ max_tokens 40000
//   B = 显式 thinking enabled budget 16000 + max_tokens 40000
//   C = 大资料包（约1.4万字符输入）+ 直出路由 + max_tokens 50000
import { readFileSync } from 'node:fs';

const mode = process.argv[2];
if (mode !== 'A' && mode !== 'B' && mode !== 'C') { console.error('usage: node wenmi-glm-probe.mjs <A|B|C>'); process.exit(1); }

const envText = readFileSync('/opt/wenmi/deploy/.env.production', 'utf8');
const match = envText.match(/^WENMI_ARK_CODING_PLAN_API_KEY=(.+)$/m);
if (!match) { console.error('KEY_NOT_FOUND'); process.exit(1); }
const apiKey = match[1].trim();

const systemPrompt = '你是文秘写作中的正式规划成员。严格执行输入中的operation、instructions和outputContract，只输出一个可直接解析的JSON对象，不用Markdown，不写解释、确认请求或后续承诺。';

const userPrompt = `operation: design_volume_plan
instructions: 为以下书籍设计第一卷的完整卷规划。要求：卷名、卷定位说明、本卷核心冲突、5个章节组（每组含组名、目的、关键事件、出场人物、悬念钩子）、卷末状态与第二卷衔接点。所有设定必须只用本书提供的资料，不得引用未提供的资产。
outputContract: {"volumeTitle":string,"positioning":string,"coreConflict":string,"chapterGroups":[{"name":string,"purpose":string,"keyEvents":string,"characters":string[],"hook":string}],"endingState":string,"nextVolumeLink":string}
本书资料：书名《长安账房》。背景：贞观年间，主角沈砚是户部一名从九品记账小吏，意外发现各地漕运账目存在系统性亏空，牵连漕帮与朝中转运使一系。主角性格谨慎、擅长数字推理，靠一手过目不忘的算账功夫在官僚体系中步步周旋。主线：从一册对不上的漕粮账开始，查到江南转运司，再卷入朝堂漕政改革之争。第一卷范围：从发现账目异常到第一次被灭口未遂，主角决定主动出击。主要人物：沈砚（主角）、老主事周秉（引路人）、漕帮账房柳三娘（亦敌亦友）、转运使党羽崔判官（本卷反派）。`;

// 模拟生产规模的大资料包：在原任务之上追加约1.4万字符的设定/章节组资料，
// 迫使模型在规划前消化大量上下文（生产失败调用的真实形态）。
const bigContext = `
【参考资料包】
一、朝堂势力设定（约4000字）
尚书省总管全国漕运账目核覆，户部度支司每旬汇总各道申报，转运使一职名义上分掌地方财赋转运，实则形成独立账房体系。崔判官任度支司员外郎，负责漕粮核销复核，与江南转运使王缜互为姻亲。漕帮在扬州、汴州各设大栈，账房柳三娘掌扬州栈流水。老主事周秉曾在贞观六年经手一桩漕损旧案，案卷封存于架阁库丙字三柜。朝廷对账目亏空的容差为每石三升，超出即立案。
二、前情章节组资料（约6000字）
第一章组「对不上的账」：沈砚核出江淮道申报与实收差四百七十石，超出容差百倍，周秉劝其装聋作哑。第二章组「架阁库之夜」：沈砚夜查贞观六年旧案，发现同样手法、同样签押。第三章组「扬州行」：沈砚借调扬州对账，初会柳三娘，漕帮栈单与官账可互为镜像印证。第四章组「灭口」：回京途中驿馆失火，沈砚幸免，决意主动出击。第五章组「反客为主」：沈砚以假账本钓鱼，诱崔判官党羽上钩。
三、写作约束（约2000字）
正文禁止出现任何创作过程说明；历史细节须符合贞观年间职官与度量衡；数字推理场景须给读者留出可复核线索；每章末尾保留一个未解疑点；反派不能脸谱化，崔判官须有自己的处境逻辑；柳三娘每次出场必须推进账目线索至少一项。
`.repeat(4);

const body = {
  model: 'glm-5.3',
  max_tokens: mode === 'C' ? 50000 : 40000,
  temperature: 0.4,
  ...(mode === 'B' ? { thinking: { type: 'enabled', budget_tokens: 16000 } } : {}),
  system: systemPrompt,
  messages: [{ role: 'user', content: mode === 'C' ? userPrompt + bigContext : userPrompt }]
};

const started = Date.now();
let response;
try {
  response = await fetch('https://ark.cn-beijing.volces.com/api/coding/v1/messages', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
} catch (error) {
  console.log(`MODE=${mode} FETCH_ERROR name=${error?.name} msg=${error?.message} elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(1);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (!response.ok) {
  const text = await response.text().catch(() => '');
  console.log(`MODE=${mode} HTTP=${response.status} body_head=${JSON.stringify(text.slice(0, 200))} elapsed=${elapsed}s`);
  process.exit(1);
}
const data = await response.json();
const blocks = Array.isArray(data.content) ? data.content : [];
const types = blocks.map((b) => b.type).join(',');
const thinkingChars = blocks.reduce((n, b) => n + (typeof b.thinking === 'string' ? b.thinking.length : 0), 0);
const textBlocks = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text.trim()).filter(Boolean);
const outputLen = textBlocks.join('\n').length;
console.log([
  `MODE=${mode}`,
  `HTTP=200`,
  `stop_reason=${data.stop_reason}`,
  `blocks=${blocks.length} types=${types}`,
  `thinking_chars=${thinkingChars}`,
  `output_chars=${outputLen}`,
  `output_tokens=${data.usage?.output_tokens ?? '?'}`,
  `input_tokens=${data.usage?.input_tokens ?? '?'}`,
  `elapsed=${elapsed}s`,
  `output_head=${JSON.stringify(textBlocks.join('\n').slice(0, 150))}`
].join(' | '));
