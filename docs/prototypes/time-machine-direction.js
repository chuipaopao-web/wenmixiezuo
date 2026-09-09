// Proposed direction contracts; no production task or manuscript state is changed.
const directionCards=[
 [
 ['让无灵根的林舟凭机甲取得持续立足的道路。','保住铺子 → 建立协作工坊 → 参与大陆工程。','机甲道路在最终危机中证明价值，并有继续存在的条件。',[[1,'推进','保住铺子，取得第一批订单。'],[2,'推进','建立团队交付能力。'],[3,'推进','拓展材料与客户来源。'],[4,'转折','旧记录改变研发判断。'],[5,'阶段兑现','事业不再只依靠林舟一人。'],[6,'转折','工坊能力不足以应对大陆危机。'],[7,'阶段兑现','联合工程完成局部验证。'],[8,'最终收束','完成共同工程，机甲道路获得立足条件。']]],
 ['机甲从被使用的工具，成为能决定自己行动的伙伴。','出现意愿 → 被认真对待 → 取得决定权。','关键行动由机甲自主选择，伙伴接受并共同承担结果。',[[4,'推进','林舟开始认真对待机甲的意愿。'],[7,'转折','联盟承认机甲有参与决定的资格。'],[8,'最终收束','机甲自主决定终局行动。']]],
 ['被排斥的匠人找到能长期合作而非依附一人的位置。','聚集 → 分歧 → 离开与重聚 → 约定合作。','匠人们选择去留与职责，形成能自行运行的合作关系。',[[2,'推进','匠人开始共同完成订单。'],[3,'推进','互市扩大合作边界。'],[5,'转折','技术归属与利益分歧浮现。'],[6,'推进','抢修中的取舍暴露合作裂痕。'],[7,'最终收束','去留、职责和技术共享条件落定。']]],
 ['查清机关传承被误解与天劫预言出错的关键原因。','异常零件 → 遗迹记录 → 现场验证 → 推翻误判。','证据足以解释误判原因，并明确旧解释为何不可继续采用。',[[1,'推进','留下异常零件线索。'],[3,'推进','取得遗迹的去向。'],[4,'转折','确认旧解释与实物不符。'],[7,'最终收束','拼合证据、确认误判；将结论交给终局工程。']]]
 ],
 [
 ['找出被遗弃机关背后的历史真相。','追索 → 比对 → 验证 → 纠正旧答案。','形成可核实的历史解释，明确旧方案错误。',[[1,'推进','取得实物线索。'],[2,'推进','带回秘境记录。'],[3,'推进','获得异族证据。'],[4,'推进','修复关键入口。'],[5,'转折','权威图纸验证失败。'],[6,'最终收束','拼合各方证据，确认旧答案的错误。']]],
 ['让林舟从照着图纸修，走向为新局面创造方案。','依赖旧图 → 质疑权威 → 独立验证 → 共同实施。','用经验证的新方案回应危机，而非照搬古人答案。',[[1,'推进','运用修理能力接下委托。'],[2,'推进','用工程判断带队脱困。'],[4,'推进','修复遗迹通路。'],[5,'转折','放弃错误图纸。'],[6,'推进','形成可检验的新方案。'],[7,'阶段兑现','替代办法通过局部验证。'],[8,'最终收束','把方案实施为共同工程。']]],
 ['让不同目的的同行者决定是否继续共同承担风险。','同行 → 隐瞒与分歧 → 交换证据 → 承诺合作。','伙伴的去留与承担方式明确，不强迫所有人同路。',[[2,'推进','发现队伍内部的隐瞒。'],[3,'转折','异族伙伴加入改变关系。'],[6,'推进','面对各方历史责任。'],[7,'最终收束','明确去留与共同承担的承诺。']]],
 ['承认机魂不是旧工具的重演，而是有自己未来的生命。','表达意愿 → 拒绝被消耗 → 自主行动。','机甲自主决定参与，选择被伙伴尊重。',[[4,'推进','表现出独立意愿。'],[7,'转折','拒绝把机魂作为默认代价。'],[8,'最终收束','由机甲自己选择关键行动。']]]
 ],
 [
 ['让创造成为众人能共同使用的道路。','个人作品 → 工坊 → 共同工程。','创造服务于共同未来，并形成可继续发展的条件。',[[1,'推进','完成最初的创造。'],[2,'推进','形成共同制作能力。'],[3,'转折','技术用途引发分歧。'],[4,'推进','保住关键能力。'],[5,'阶段兑现','形成共同目标。'],[6,'最终收束','工程落地，创造成为共同道路。']]],
 ['让拥有不同利益的人作出自己的去留与合作选择。','加入 → 分裂 → 协商 → 共同承担。','各方能够自主决定，并承担合作或离开的后果。',[[1,'推进','不同诉求相遇。'],[2,'推进','试行合作。'],[3,'转折','伙伴选择不同道路。'],[4,'推进','危机迫使各方表态。'],[5,'阶段兑现','重新约定合作条件。'],[6,'最终收束','实际行动兑现各方选择。']]],
 ['把机甲的自由落实为可拒绝的权利。','控制 → 倾听 → 放手。','林舟允许机甲拒绝，并接受它自己的决定。',[[4,'推进','保护机魂而非只保设备。'],[6,'最终收束','放下控制，尊重自主选择。']]],
 ['查明错误预言，并让各方面对旧事的责任。','各持片段 → 拼合证据 → 承认责任。','错误原因得到确认，相关责任被各方面对。',[[5,'最终收束','核对证据、确认误判并明确责任。']]]
 ]
];
function directionDetail(id){const j=+id-1,c=directionCards[route][j],l=D.routes[route].lines[j];dialog(`${id} · ${l[1]}`,`<span class="pill">${l[0]==='主线'?'主线':'重要支线'} · 规划候选</span><h3>追求什么</h3><p>${c[0]}</p><h3>关键变化</h3><p>${c[1]}</p><h3>怎样才算回应了这条线</h3><p>${c[2]}</p><h3>预计推进与收束</h3><div class="duty-timeline">${c[3].map(x=>`<p><b>第${x[0]}卷 · ${x[1]}</b><br>${x[2]}</p>`).join('')}</div><p class="sub">这是计划，不代表正文已经发生。未列出的卷不自动新增推进或收束任务。</p>`)}
function improveDirection(){const cards=directionCards[route],r=D.routes[route];
 document.querySelectorAll('.line-entry').forEach((el,i)=>{const c=cards[i],last=c[3].at(-1);el.querySelector('div').insertAdjacentHTML('beforeend',`<small class="line-window">预计第${c[3][0][0]}—${last[0]}卷展开 · 第${last[0]}卷回应</small>`)});
 document.querySelectorAll('.vol').forEach((el,i)=>{const duties=cards.flatMap((c,j)=>c[3].filter(x=>x[0]===i+1).map(x=>({id:String(j+1).padStart(3,'0'),kind:x[1],text:x[2]})));const last=i===r.volumes.length-1;const featured=route===0&&i===6;const end=featured?'联合工程通过一次局部灾变验证；各方合作职责落定；天劫误判原因已有证据解释。三件事落定后，本卷结束，不等待完整天劫结束。':volumeBeats[route][i].at(-1);
 el.querySelector('.volume-lines').outerHTML=`<section class="volume-duties"><h3>各条故事线，本卷做到哪里</h3>${duties.map(d=>`<div class="duty-row"><button data-story="${d.id}">${d.id}</button><div><span class="duty-tag ${d.kind==='最终收束'?'closing':''}">${d.kind}</span><p>${d.text}</p></div></div>`).join('')}</section>`;
 const outcomes=el.querySelector('.volume-outcomes');const oldEnd=outcomes.lastElementChild;oldEnd.remove();
 outcomes.insertAdjacentHTML('afterend',`<section class="handoff-card"><h3>本卷怎样结束</h3><p>${end}</p><h3>${last?'全书最终落点':'留给后续什么'}</h3><p>${featured?'工程已通过局部验证，但完整天劫仍未应对。下一卷继承联盟与历史结论，重点完成001的共同工程和002的自主选择；不重开003、004已经解决的问题。':esc(r.volumes[i].next)}</p>${last?'<p class="sub">此前已收束故事的成果可以发挥作用，不等于重新开启该故事线。</p>':''}</section>`);
 });
 const vols=document.querySelectorAll('.vol');vols.forEach((el,i)=>{if(i!==0)return;el.querySelector('.volume-card').insertAdjacentHTML('beforeend','<button class="chain-contract-button">查看后续链的交接示例</button>');el.querySelector('.chain-contract-button').onclick=()=>dialog('链的交接示例 · 不是新增规划',`<span class="pill">以完成一笔订单为例</span><p>卷确定阶段目标，链完成具体故事；链不等于支线。</p><h3>当前局面</h3><p>已接下订单，机甲尚未通过验收。</p><h3>本链要完成什么</h3><p>解决交付故障，让验收与订单责任有明确结论。</p><h3>什么时候结束</h3><p>验收通过或失败已经确定，报酬或违约责任已经落定。不因旧零件的谜未解而继续拖延。</p><h3>交给下一条链</h3><p>实际验收结果、剩余资源、角色关系变化，以及仍未查明的零件来源。</p><h3>如果正文偏离计划</h3><p>保留原计划，以作者接受的正文结果为准调整后续；不把失败改写成成功，也不要求重写已接受正文。</p><p class="sub">正式开发后记录来源与版本。此处只展示交接结构，不声称该书已发生这些事件。</p>`)});
 document.querySelectorAll('[data-story]').forEach(b=>b.onclick=()=>directionDetail(b.dataset.story));
}
const previousDirectionRenderer=renderResult;
renderResult=function(){previousDirectionRenderer();improveDirection();
 const members=[['红玉','0%'],['幼薇','20%'],['苏映棠','40%']];
 document.querySelectorAll('[data-route]').forEach((b,i)=>{const [name,x]=members[i];b.innerHTML=`<span class="scheme-member"><i role="img" aria-label="${name}头像" style="background-image:url('${D.memberSprite}');background-position:${x} 33.333333%"></i><span><strong>${name}</strong><small>策划编剧</small></span></span><span class="scheme-name">${D.routes[i].short}</span>`;b.setAttribute('aria-label',`${name}的方案：${D.routes[i].short}`)});
 $('.scheme-tabs').insertAdjacentHTML('afterend','<p class="member-demo-note">成员席位演示 · 当前样例未由这三位成员实际生成</p>');
};
