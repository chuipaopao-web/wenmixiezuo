const baseUrl = 'http://127.0.0.1:43111';
const bookId = '4d348004-ed3e-4aac-8cf6-6473bc82957b';

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin: 'http://127.0.0.1:43110',
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return { body: body.data, response };
}

const session = await request('/api/v1/runtime/session', { method: 'POST', body: '{}' });
const cookie = session.response.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('runtime session cookie missing');
const headers = { cookie, 'content-type': 'application/json' };

const artifacts = (await request(`/api/v1/books/${bookId}/artifacts`, { headers })).body;
const master = artifacts.find((item) => (item.artifact_type ?? item.artifactType) === 'master_outline' && item.status === 'selected')
  ?? artifacts.find((item) => (item.artifact_id ?? item.artifactId) === 'd9d40f62-2d0a-43b3-814c-ad41afbb20d5');
if (!master) throw new Error(`selected master outline not found: ${JSON.stringify(artifacts.map((item) => ({ id: item.artifact_id ?? item.artifactId, type: item.artifact_type ?? item.artifactType, status: item.status })))}`);

const masterId = master.artifact_id ?? master.artifactId;
const activeVersionId = master.active_version_id ?? master.activeVersionId;

const previous = master.active_content ?? master.activeContent ?? {};
const content = {
  ...previous,
  schema: 'stage_master_v2',
  title: '第一阶段剧情总纲：救援之后',
  stageMode: 'single_major_event',
  planningRule: '本阶段只约束第1—9章“救援之后”的完整事件；后续阶段另行规划。',
  stages: [{
    stage: 1,
    title: '救援之后：把善意变成可撤回的合作',
    chapterRange: { start: 1, end: 9 },
    estimatedCharacters: { minimum: 22500, recommended: 27000, maximum: 31500 },
    plotPatterns: {
      primary: { id: 'mutual-salvation', name: '双向救赎' },
      supporting: [
        { id: 'startup-survival', name: '创业求生' },
        { id: 'evidence-reversal', name: '证据反转' }
      ],
      usage: '双向救赎负责人物关系，创业求生负责现实行动，证据反转负责阶段高潮；不照搬套路。'
    },
    dramaticQuestion: '王怡和夏炎能否在不把救助变成控制、感激变成依附的前提下，用可撤回、可核验的记录重建各自的生活边界？',
    stageGoal: '完成一次从偶然救援到平等合作的关系重建，并找回被删除的实验结论。',
    startState: '王怡刚救下轻生的夏炎；两人存在年龄、资源和债务差，实验记录的伦理与归属均未厘清。',
    conflictDesign: {
      surface: '赔偿、债务、账户、记录公开与成果归属发生冲突。',
      underlying: '救助与控制、感激与依附、客观证据与主观解释持续拉扯。',
      stakes: '两人的尊严、自主权、信任以及实验结论的真实性。',
      failureCost: '关系退化成另一场控制实验，王怡再次失去选择权，夏炎也无法真正重新生活。'
    },
    mainline: '王怡在家门口发现夏炎留下的越野车，由赔偿问题进入他的债务与实验记录。两人通过拆账、建立可撤回实验规则、公开错误清单、划分独立账户，逐步把救命之恩改造成平等合作。最终，他们共同找回一份被删除的结论，确认这段关系不能以牺牲任何一方的自主性为代价。',
    structure: {
      setup: '第1—2章：越野车与赔偿边界把两人重新拉回同一张桌子，明确善意也需要边界。',
      development: '第3—5章：公开记录、拆分债务并建立可撤回实验，关系从情绪承诺转向可核验规则。',
      turn: '第6—7章：错误清单暴露各自隐瞒与代偿心理，两人拒绝替对方作证，冲突转向自主权。',
      resolution: '第8—9章：独立账户落地，被删除的结论恢复；双方以平等合作而非拯救关系结束本阶段。'
    },
    chapterPlan: [
      { range: '1—2', purpose: '建立越野车、赔偿和边界冲突。', characters: ['王怡', '夏炎'], tone: '戒备中带荒诞', turn: '赔偿被重新定义为可核验责任。' },
      { range: '3—5', purpose: '公开记录、拆账并建立可撤回实验。', characters: ['王怡', '夏炎', '奶奶'], tone: '克制、试探', turn: '王怡取得随时退出的权利。' },
      { range: '6—7', purpose: '以错误清单和拒绝代证逼出真实动机。', characters: ['王怡', '夏炎'], tone: '压抑后清醒', turn: '两人承认善意也可能构成控制。' },
      { range: '8—9', purpose: '分离账户并恢复被删除的结论。', characters: ['王怡', '夏炎'], tone: '释然但保留悬念', turn: '关系转为平等合作，留下实验结论为何被删的后续线索。' }
    ],
    completionCriteria: [
      '赔偿、债务与两个账户的边界清楚且可执行',
      '可撤回实验规则由双方明确同意',
      '被删除的结论被恢复并说明其阶段意义',
      '两人关系从单向救助转为平等合作'
    ],
    hardConstraints: [
      '王怡和夏炎都保留退出关系与实验的权利',
      '不得用巧合替代债务、证据和记录的因果链',
      '本阶段不提前解决全书悬疑，也不把救赎写成依附'
    ],
    creativeFreedom: [
      '允许调整具体场景、对话、视角与章节内节奏',
      '允许增加不改变主因果的小人物和生活细节',
      '允许在克制基调中加入幽默和温暖反差'
    ],
    summary: '本阶段用九章完成“偶然救援—边界冲突—规则共建—真相恢复”的闭环，让两位主角获得继续同行但不互相占有的理由。',
    pendingThreads: [
      '实验结论最初由谁删除、为何删除',
      '奶奶对王怡身份和实验的真实了解程度',
      '夏炎过去失败与债务是否存在尚未公开的责任方'
    ],
    followUp: '下一阶段从被恢复结论的来源展开，不重复本阶段的赔偿冲突。'
  }]
};

const created = (await request(`/api/v1/books/${bookId}/artifacts/${masterId}/versions`, {
  method: 'POST', headers, body: JSON.stringify({ content, parentVersionId: activeVersionId })
})).body;
const versionId = created.artifactVersionId ?? created.artifact_version_id;
if (!versionId) throw new Error(`new version id missing: ${JSON.stringify(created)}`);
await request(`/api/v1/books/${bookId}/artifacts/${masterId}/select`, {
  method: 'POST', headers, body: JSON.stringify({ versionId })
});

const refreshed = (await request(`/api/v1/books/${bookId}/artifacts`, { headers })).body;
const selected = refreshed.find((item) => (item.artifact_id ?? item.artifactId) === masterId);
const chapterOutlines = refreshed.filter((item) => (item.artifact_type ?? item.artifactType) === 'chapter_outline' && item.status === 'selected');
console.log(JSON.stringify({
  bookId,
  chapterOutlineCount: chapterOutlines.length,
  chapterOutlineTitles: chapterOutlines.map((item) => item.title),
  masterVersionId: selected?.active_version_id,
  masterSchema: selected?.active_content?.schema,
  masterStage: selected?.active_content?.stages?.[0]
}, null, 2));
