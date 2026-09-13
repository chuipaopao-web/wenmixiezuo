export const CHAIN_PAYOFF_CHECK='仅链设计检查：无论采用哪种节奏，检查期待兑现、当事人反应、相关人物/关系/利益的影响，以及情绪落地后及时收束与承接。不强制各方震惊、独立余韵章或固定篇幅；不把其他节奏统一改成四段。全书和卷不执行此检查。';
export function refineChainRhythm(code,source){
 const p=structuredClone(source);if(p.assetKind!=='method')return null;
 const m=p.method;let changed=false;
 if(code==='法012'){
  p.aliases=[...new Set([...p.aliases,p.name])];m.aliases=[...new Set([...m.aliases,p.name])];
  p.name=p.shortPhrase=m.title='开端—推进—兑现—余韵扩散';
  p.summary='链内先建立目标与期待，经行动和变化兑现结果，再用人物反应及相关影响让情绪落地。';
  m.instruction='开端：明确谁要做成什么、为何现在行动及读者期待。推进：通过行动、阻力、选择和变化增强结果的重要性。兑现：回答关键冲突，落实成功、失败或目标变化及收益与代价。余韵扩散：按事件分量呈现当事人反应、关系与利益变化，让结果可感知后及时收束。扩大的是结果的影响，不是强行扩大事件规模。例：救下工匠后，同伴愿意共同建坊，原本拒绝合作的人递来订单；不连续安排多人重复惊呼。';
  m.boundary='仅用于链设计；不用于全书、分卷或卷的粗节奏。四段是本方法的一种选择，不规定章数和比例。余韵可短至一个动作，不额外拉长许多章节，不为套结构强造牺牲。';
  m.applicableLayers=['chain'];m.conditionalUses=[];changed=true;
 }
 if(['兑现与余韵','让余韵带出行动'].includes(p.name)){
  m.applicableLayers=m.applicableLayers.filter(s=>!['book','volume'].includes(s));
  m.conditionalUses=(m.conditionalUses??[]).filter(c=>!['book','volume'].includes(c.stage));
  m.boundary=m.boundary.split('\n').filter(l=>!l.startsWith('时光机：')&&!l.startsWith('卷：')).join('\n');
  m.boundary+='\n本方法不供全书/卷粗节奏规划余韵段；链内设计后可在具体场景落实，不要求专门安排多个余韵章节。';changed=true;
 }
 if(['宏观节奏','情绪节奏'].includes(m.usageTree)||code==='法012'){
  m.boundary=m.boundary.split('\n').filter(l=>!l.startsWith('仅链设计检查：')).join('\n')+'\n'+CHAIN_PAYOFF_CHECK;changed=true;
 }
 return changed?p:null;
}
