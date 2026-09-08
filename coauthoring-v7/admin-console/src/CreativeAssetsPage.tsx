import { useState } from 'react';
import { CREATIVE_ASSETS, CREATIVE_ASSET_VERSION, CREATIVE_SCALES, READING_STYLES, creativeDirective, normalizeCreativeProfile, openingCreativeCatalog } from '@wenmi/agent-catalog';
import './rhythm-assets.css';

export function CreativeAssetsPage(): React.JSX.Element {
 const [query,setQuery]=useState('');
 const [category,setCategory]=useState('全部');
 const [scale,setScale]=useState(4);
 const categories=['全部',...new Set(CREATIVE_ASSETS.map(card=>card.category))];
 const cards=CREATIVE_ASSETS.filter(card=>(category==='全部'||card.category===category)&&`${card.name}${card.summary}`.includes(query));
 return <section className="rhythm-page">
  <header><h2>创意与金手指</h2><p>{CREATIVE_ASSETS.length}张机制卡 · {CREATIVE_ASSET_VERSION} · 开书完整精简目录约{JSON.stringify(openingCreativeCatalog()).length}字符</p></header>
  <section className="asset-panel"><h3>已确定的设计方案</h3><p>首页直接输入想法、选择头像成员、创意尺度、风格偏向和作品类型。取消“自己设计”和独立类型页面，保留生成后的修改与换成员。</p><p>开书设计成员接收全部卡片的编号、名称和一句说明，自主选用、组合或原创；系统不按关键词硬筛，不额外调用资料成员选卡。资料是灵感，不是作品事实。库覆盖六类机制，持续补充，不宣称全网最全。</p><p>创意尺度与偏向随开书任务冻结，作者确认建书后保存到该书。设定、全书规划、卷链与正文任务只收到本节点的短指令，不重复搬运全库。技术重试复用原快照；审查保留姓名、作者要求与必要结构，高尺度不因荒诞或无厘头返工。</p><p>网文可用；剧本流程尚未开放。默认 DeepSeek V4 Pro，尺度默认“荒诞猎奇”。实际调用与资料包请在“功能与AI流程”对应节点查看。本页使用与执行器相同的版本化源，随发布更新。</p></section>
  <section className="asset-panel"><h3>节点提示预览</h3><p>一个主偏向＋最多四个辅助偏向。主偏向持续主导，辅助按节点和情节使用，不要求每章全部体现；不选则由成员判断。旧选择首项为主，其余为辅助。</p><label>尺度 <select value={scale} onChange={event=>setScale(Number(event.target.value))}>{CREATIVE_SCALES.map(item=><option value={item.level} key={item.level}>{item.name}</option>)}</select></label><p>风格偏向：{READING_STYLES.join('、')}</p>{['opening','setting','volume'].map(stage=><div key={stage}><h4>{stage==='opening'?'开书设计与审查':stage==='setting'?'设定设计与审查':'全书、卷链与正文'}</h4><p>{String(creativeDirective(normalizeCreativeProfile({scale}),stage)?.stageInstruction)}</p><p>{String(creativeDirective(normalizeCreativeProfile({scale}),stage)?.review)}</p><p>{String(creativeDirective(normalizeCreativeProfile({scale}),stage)?.preferences)}</p></div>)}</section>
  <section className="asset-panel"><h3>完整机制库</h3><label>查找机制 <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="金手指、反差、搞怪…" /></label><label> 分类 <select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select></label><p>显示{cards.length}项；筛选仅用于后台查看，不改变开书注入。</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:12}}>{cards.map(card=><article key={card.id} style={{border:'1px solid #dce7e0',borderRadius:12,padding:16}}><small>{card.id} · {card.category}</small><h4>{card.name}</h4><p>{card.summary}</p></article>)}</div></section>
 </section>;
}
