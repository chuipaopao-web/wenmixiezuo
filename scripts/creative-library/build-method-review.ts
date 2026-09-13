import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {groups,corrections,merges} from './method-review.js';
import {validatePayload} from '../../apps/api/src/application/creative-reference/validation.js';
const raw=readFileSync('scripts/creative-library/generated/seed.json');
if(createHash('sha256').update(raw).digest('hex')!=='ef065f3dab1b196cac7b1cff0e473de9024cc443fc928963a60c1b5a910148a9')throw Error('C1来源已变化，不能按冻结序号判定');
const seed=JSON.parse(raw.toString());const source=seed.entries.filter((e:any)=>e.payload.assetKind==='method');
const stages:Record<string,string>={'开':'opening','设':'setting','时':'book','卷':'volume','链':'chain','章':'chapter','文':'prose'};
const labels:Record<string,string>={opening:'开书',setting:'设定',book:'时光机',volume:'卷',chain:'链',chapter:'章纲',prose:'正文'};
const responsibilities:Record<string,string>={opening:'作为候选构思说明本书可能有什么看点，不写成已确认事实',setting:'只确定相关人物、关系或规则的必要前提，不提前写完整剧情',book:'规划全书或跨卷的作用与重要变化，留下具体事件空间',volume:'结合本卷开始与收束分配承担该作用的链，不强制平均安排',chain:'落实当前故事的目标、过程、结果及与相关线的衔接',chapter:'安排本章承担的行动、场面或信息，不要求本章独自走完全套结构',prose:'在当前正文落实行动与表达，按人物关注取舍细节'};
const byIndex=new Map<number,readonly string[]>();
for(const g of groups)for(const n of g[4].split(' ').map(Number)){if(byIndex.has(n))throw Error('重复判定 '+n);byIndex.set(n,g);}
if(source.length!==346||byIndex.size!==346||source.some((_:unknown,i:number)=>!byIndex.has(i+1)))throw Error('方法判定遗漏');
const entries=source.map((e:any,i:number)=>{
 const n=i+1,g=byIndex.get(n)!,c=corrections[n],m=merges.find(x=>x.from===n);
 const p=structuredClone(e.payload),name=c?.name??p.name,instruction=c?.instruction??p.method.instruction;
 const stageKeys=[...g[1]!].map(x=>stages[x]!);
 // 每条记录自己的机制与本层责任；字段使用现有可完整保存的instruction/boundary文本，不引入未验证协议。
 const useWhen=`${g[2]}时，考虑“${name}”。`;
 const stageUses=stageKeys.map(stage=>({stage,use:`${responsibilities[stage]}。`}));
 p.name=name;p.shortPhrase=name;p.summary=instruction;
 p.method={...p.method,title:name,instruction,usageTree:g[0],applicableLayers:stageKeys,
  boundary:[`使用条件：${useWhen}`,`误用边界：${c?.boundary??g[3]}`,...stageUses.map(s=>`${labels[s.stage]}：${s.use}`)].join('\n')};
 const target=merges.find(x=>x.to===n);
 if(target){const old=source[target.from-1];p.aliases=[...new Set([...p.aliases,old.payload.name,old.payload.aliases[0],`法${String(target.from).padStart(3,'0')}`])];p.method.aliases=p.aliases;}
 if(m){p.summary=`已合并至法${String(m.to).padStart(3,'0')} ${corrections[m.to]?.name??source[m.to-1].payload.name}。${m.reason}`;p.method.boundary=`合并说明：${p.summary}\n${p.method.boundary}`;}
 validatePayload(p);
 return {seedKey:e.key,expectedRevision:1,expectedPayload:e.payload,payload:p,stageUses,useWhen,decision:m?'merge':'retain',mergeTargetSeedKey:m?source[m.to-1].key:null,reason:m?.reason??(c?'修正原说明及用途/阶段边界':'逐项阅读后保留准确机制，补齐用途和阶段责任')};
});
const additions=[
 ['premise-recombination','题材机制重组','横向机制','开设时','将熟悉身份、能力或环境重新组合，使一种变化真正改变行动方式。','需要从初始想法发展出区别于常规故事的玩法。','不同于角色在故事内创新；此法用于作者构思，不以标签数量代替差异。'],
 ['fusion-stress-test','融合机制检验','规则兼容','开设时','检验两种题材的规则、回报和人物目标是否互相支持，明确主要阅读体验。','两个题材融合后出现互相抵消或各写各的。','不要求均分戏份；无法兼容时可舍弃一项，不叠加更多设定补洞。'],
 ['premise-counterfactual','单条件变更构思','题材特征','开设时','选择熟悉处境的一项关键条件作改变，追踪人物机会、关系和代价如何随之变化。','题材熟悉但缺少能持续展开的差异。','只改一个条件是构思起手式，不是全书只准一种变化。'],
 ['appeal-action-test','卖点行动验证','核心吸引力','开时卷链','用一件代表性行动检验卖点：主角具体做什么，读者会看到什么不同结果。','介绍很热闹但不知道正文能写什么有趣事件。','例子是候选，不提前强制章纲；与角色公开证明能力不是同一用途。'],
 ['appeal-growth-matrix','卖点发展维度','核心吸引力','开时卷链','从对象、规模、关系、责任或代价中选择真正会变化的维度，让同一卖点产生不同故事。','职业或金手指只有重复任务，长篇发展空间不足。','不要求全部维度不断扩大，允许深挖、小规模和日常回报。'],
 ['reader-reward-fit','阅读回报匹配','情绪回报','开时卷链','结合作者味道，选择能力、尊严、关系、安宁、智力参与等可选体验，并给出具体兑现方式。','有题材标签但缺少读者能感受到的回报。','不能推断所有读者都有同一种欲望；不强制打脸、恋爱或复仇。'],
 ['premise-intent-check','构思意图复核','意图一致','开设时卷链章','将当前构思与作者明确要求逐项对照，区分已确定、可建议和无依据新增。','参考库建议可能挤掉作者原本想写的内容。','不把模型偏好当质量事实，软建议不冒充禁止边界。'],
 ['story-capacity-test','长篇发展空间检验','结构检查','开时卷','用不同目标、阻力、关系变化和结果检验预计篇幅是否有足够实质内容。','目标字数很长但只有开局和结局，或反复换皮。','数量仅作规划参考；不以强制支线数代替故事质量。']
].map(([key,purposeName,purpose,scope,instruction,when,boundary])=>({key:`c2-${key}`,payload:{assetKind:'method',name:purposeName,shortPhrase:purposeName,summary:instruction,aliases:[],method:{title:purposeName,instruction,usageTree:purpose,applicableLayers:[...scope!].map(s=>stages[s]!),aliases:[],boundary:[`使用条件：${when}`,`误用边界：${boundary}`,...[...scope!].map(s=>`${labels[stages[s]!]!}：${responsibilities[stages[s]!]!}。`)].join('\n')}},reason:'原库以叙事执行为主，补作者层面的构思判断；不同于角色行动策略。'}));
additions.forEach(a=>validatePayload(a.payload as any));
const output={batch:'r209-c2-methods',reviewer:'Codex',reviewType:'逐条编辑核查，非异模型独立审核或模型效果实测',counts:{sources:346,merged:merges.length,retained:346-merges.length,added:additions.length,total:346-merges.length+additions.length},entries,additions};
mkdirSync('scripts/creative-library/generated',{recursive:true});
const json=JSON.stringify(output,null,2)+'\n';writeFileSync('scripts/creative-library/generated/method-review.json',json);writeFileSync('scripts/creative-library/generated/method-review.sha256',createHash('sha256').update(json).digest('hex')+'\n');
console.log(JSON.stringify({counts:output.counts,hash:createHash('sha256').update(json).digest('hex')}));
