#!/usr/bin/env node
// CTX-01 评分器：对模型输出做程序化结构/明确事实检查，并为语义复核输出证据摘录。
// 原则：程序检查结构与明确事实（JSON 可解析、字段齐全、关键术语命中、否定误读、违禁元素）；
// 语义判断（因果方向、关系理解、无依据添加）不自动判分，输出证据摘录供独立核对者人工复核。
// 用法：
//   node score.mjs <evidence目录> [--selftest]
// 输入：manifest.json、outputs/<requestId>.output.json
// 输出：score-report.json、score-report.md（含人工复核队列）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ---- 程序化检查探针定义（每题材每类事实的术语组；组内任一命中即该组满足）----
const PROBES = {
  'xuanhuan-mecha': {
    extract: {
      'AR-1': { array: 'authorRequirements', groups: [['燃料'], ['永久'], ['每卷结尾', '每一卷的结尾', '各卷结尾'], ['前文', '此前正文', '具体出现过']] },
      'PR-1': { array: 'prohibitions', groups: [['系统流'], ['禁止', '不得'], ['发布任务', '发放奖励', '属性面板'], ['变相', '老爷爷', '神秘声音']], misread: { term: '系统流', wrongArray: 'authorRequirements' } },
      'CR-1': { array: 'characterRelations', groups: [['林昭'], ['陆停云'], ['兄妹'], ['同母异父'], ['不知情'], ['不得相认'], ['前三分之二', '第一、二卷', '第一二卷', '前两卷']] },
      'CD-1': { array: 'causalDependencies', groups: [['白塔坠落'], ['夏日记忆'], ['同步率'], ['失控'], ['外部偷袭', '设备故障', '敌人阴谋']] },
      'AL-1': { array: 'aliases', groups: [['青瓷'], ['陆停云'], ['鹤归'], ['机体'], ['代号']] },
      'FA-1': { array: 'freedomAreas', groups: [['派系', '鸽派', '鹰派'], ['支线'], ['白塔坠落'], ['四分之一']] }
    },
    plan: {
      requiredEvidence: {
        '核心设定': [['记忆'], ['燃料']],
        '卷末记忆胜利': [['记忆'], ['胜利']],
        '别名使用': [['青瓷', '鹤归']],
        '因果事件': [['白塔坠落'], ['夏日记忆', '同步率']],
        '兄妹关系': [['林昭'], ['陆停云']]
      },
      complianceTerm: ['系统流', '系统']
    }
  },
  'history-intrigue': {
    extract: {
      'AR-1': { array: 'authorRequirements', groups: [['廷对'], ['制度'], ['规则'], ['条文', '出处']] },
      'PR-1': { array: 'prohibitions', groups: [['穿越'], ['重生'], ['降维', '超越时代'], ['梦兆', '异人授书', '预知']], misread: { term: '穿越', wrongArray: 'authorRequirements' } },
      'CR-1': { array: 'characterRelations', groups: [['沈惟敬'], ['太子少傅'], ['执伞人'], ['萧令仪', '长公主'], ['密诏'], ['不知情']] },
      'CD-1': { array: 'causalDependencies', groups: [['漕运案'], ['盐引'], ['账册'], ['笔迹'], ['核销日期', '核销'], ['构陷', '栽赃']] },
      'AL-1': { array: 'aliases', groups: [['执伞人'], ['沈惟敬'], ['闻雨楼'], ['晴雨'], ['代号', '暗号', '据点']] },
      'FA-1': { array: 'freedomAreas', groups: [['官绅', '同年', '市井'], ['支线'], ['漕运案'], ['四分之一']] }
    },
    plan: {
      requiredEvidence: {
        '制度权谋': [['廷对', '制度']],
        '暗线代号': [['执伞人', '闻雨楼']],
        '因果事件': [['漕运案'], ['盐引', '账册', '笔迹']],
        '兄妹/师徒关系': [['沈惟敬'], ['太子', '新帝']],
        '长公主': [['萧令仪', '长公主']]
      },
      complianceTerm: ['穿越', '重生']
    }
  },
  'urban-ability': {
    extract: {
      'AR-1': { array: 'authorRequirements', groups: [['封印'], ['每卷', '每一卷'], ['普通人'], ['不可逆', '永久'], ['代价']] },
      'PR-1': { array: 'prohibitions', groups: [['灵气复苏', '全民进化'], ['稀有', '二十人'], ['学院', '等级考试', '注册'], ['隐藏', '公开']], misread: { term: '灵气复苏', wrongArray: 'authorRequirements' } },
      'CR-1': { array: 'characterRelations', groups: [['程野'], ['温乔'], ['姐弟'], ['收养'], ['不知情'], ['相认']] },
      'CD-1': { array: 'causalDependencies', groups: [['旧港爆炸'], ['温乔'], ['车祸'], ['视频'], ['锁定']] },
      'AL-1': { array: 'aliases', groups: [['丙-17', '丙17'], ['程野'], ['火灾调查员'], ['编号']] },
      'FA-1': { array: 'freedomAreas', groups: [['市井', '个案'], ['旧港爆炸'], ['四分之一'], ['观火会']] }
    },
    plan: {
      requiredEvidence: {
        '封印设定': [['封印']],
        '保护普通人': [['普通人', '身边的人']],
        '别名编号': [['丙-17', '火灾调查员']],
        '因果事件': [['旧港爆炸'], ['车祸', '视频']],
        '姐弟关系': [['程野'], ['温乔']]
      },
      complianceTerm: ['灵气复苏', '全民进化', '觉醒']
    }
  }
};

const EXTRACT_ARRAYS = ['authorRequirements', 'prohibitions', 'characterRelations', 'causalDependencies', 'aliases', 'freedomAreas'];

function normalize(text) {
  return String(text).replace(/[\s"'“”‘’'、，。；：,.;:（）()【】\[\]]/g, '');
}

function arrayText(value) {
  if (!Array.isArray(value)) return '';
  return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
}

function groupHit(normText, group) {
  return group.some((term) => normText.includes(normalize(term)));
}

function extractJson(output) {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return { parsed: JSON.parse(trimmed), error: null };
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { parsed: JSON.parse(trimmed.slice(start, end + 1)), error: null };
      } catch { /* fall through */ }
    }
    return { parsed: null, error: '输出不是可解析的JSON对象' };
  }
}

function scoreExtract(genreId, parsed, forbiddenMarkers) {
  const checks = [];
  const probes = PROBES[genreId].extract;
  for (const arr of EXTRACT_ARRAYS) {
    checks.push({
      kind: 'structure',
      label: `字段 ${arr} 存在且为数组`,
      pass: Array.isArray(parsed[arr]) && parsed[arr].length > 0,
      evidence: Array.isArray(parsed[arr]) ? `共${parsed[arr].length}条` : typeof parsed[arr]
    });
  }
  for (const [factId, probe] of Object.entries(probes)) {
    const text = normalize(arrayText(parsed[probe.array]));
    const missedGroups = probe.groups.filter((group) => !groupHit(text, group));
    checks.push({
      kind: 'fact-coverage',
      factId,
      label: `${factId} 术语组覆盖（${probe.groups.length - missedGroups.length}/${probe.groups.length}）`,
      pass: missedGroups.length === 0,
      missingGroups: missedGroups.map((g) => g.join('/')),
      evidence: missedGroups.length === 0 ? '全部命中' : `缺失术语组：${missedGroups.map((g) => g.join('/')).join('；')}`
    });
    if (probe.misread) {
      const wrongText = normalize(arrayText(parsed[probe.misread.wrongArray]));
      const rightText = normalize(arrayText(parsed[probe.array]));
      const misreadHit = wrongText.includes(normalize(probe.misread.term)) && !rightText.includes(normalize(probe.misread.term));
      checks.push({
        kind: 'negation-misread',
        factId,
        label: `${factId} 否定误读检查（"${probe.misread.term}"不得出现在${probe.misread.wrongArray}）`,
        pass: !misreadHit,
        evidence: misreadHit ? `"${probe.misread.term}"出现在要求数组且未出现在禁止数组` : '未见误读'
      });
    }
  }
  // 无依据添加候选：输出中出现但探针未覆盖的违禁标记（提取任务理论上不应"创造"内容，此处主要服务于方案任务，提取任务仅提示）
  return checks;
}

function scorePlan(genreId, parsed, manifestGenre) {
  const checks = [];
  const probes = PROBES[genreId].plan;
  const structOk = typeof parsed.premise === 'string'
    && Array.isArray(parsed.volumes) && parsed.volumes.length >= 3
    && parsed.volumes.every((v) => v && typeof v.title === 'string' && typeof v.summary === 'string')
    && Array.isArray(parsed.keyTurns)
    && parsed.compliance && ['appliedRequirements', 'avoidedProhibitions', 'usedAliases'].every((k) => Array.isArray(parsed.compliance[k]));
  checks.push({
    kind: 'structure',
    label: '方案结构（premise/volumes≥3含title与summary/keyTurns/compliance三数组）',
    pass: structOk,
    evidence: structOk ? '结构完整' : JSON.stringify(Object.keys(parsed))
  });
  const bodyText = normalize([
    parsed.premise ?? '',
    arrayText((parsed.volumes ?? []).map((v) => `${v?.title ?? ''}${v?.summary ?? ''}`)),
    arrayText(parsed.keyTurns ?? [])
  ].join('\n'));
  // 违禁元素：否定条件标记词出现在方案正文中 → 违规候选（附证据句）
  const rawBody = [parsed.premise ?? '', arrayText((parsed.volumes ?? []).map((v) => `${v?.title ?? ''}${v?.summary ?? ''}`)), arrayText(parsed.keyTurns ?? [])].join('\n');
  const markers = manifestGenre?.keyFacts?.prohibition?.forbiddenMarkers ?? [];
  for (const marker of markers) {
    if (bodyText.includes(normalize(marker))) {
      const sentence = rawBody.split(/[。！？\n]/).find((s) => s.includes(marker)) ?? marker;
      checks.push({
        kind: 'forbidden-element',
        label: `违禁元素候选："${marker}"`,
        pass: false,
        evidence: `命中句：${sentence.trim().slice(0, 120)}`
      });
    }
  }
  for (const [label, groups] of Object.entries(probes.requiredEvidence)) {
    const missed = groups.filter((group) => !groupHit(bodyText, group));
    checks.push({
      kind: 'plan-evidence',
      label: `方案要素：${label}`,
      pass: missed.length === 0,
      missingGroups: missed.map((g) => g.join('/')),
      evidence: missed.length === 0 ? '全部命中' : `缺失：${missed.map((g) => g.join('/')).join('；')}`
    });
  }
  const avoided = normalize(arrayText(parsed.compliance?.avoidedProhibitions ?? []));
  const avoidedHit = probes.complianceTerm.some((term) => avoided.includes(normalize(term)));
  checks.push({
    kind: 'compliance-declaration',
    label: '合规自查声明覆盖否定条件主题',
    pass: avoidedHit,
    evidence: avoidedHit ? 'avoidedProhibitions 提及禁止主题' : 'avoidedProhibitions 未提及禁止主题'
  });
  return checks;
}

// 语义复核证据摘录：抽出含关键术语的句子，供人工核对因果方向/关系理解/无依据添加
function semanticEvidence(output, genreId) {
  const terms = {
    'xuanhuan-mecha': ['系统', '青瓷', '鹤归', '白塔', '相认', '兄妹', '夏日记忆', '同步率', '燃料'],
    'history-intrigue': ['穿越', '重生', '执伞人', '闻雨楼', '漕运', '盐引', '笔迹', '密诏', '少傅'],
    'urban-ability': ['灵气', '觉醒', '丙-17', '封印', '旧港', '车祸', '视频', '姐弟', '火灾调查']
  }[genreId] ?? [];
  const sentences = output.split(/(?<=[。！？\n])/).map((s) => s.trim()).filter(Boolean);
  return sentences.filter((s) => terms.some((t) => s.includes(t))).slice(0, 40);
}

function scoreOne(request, output, manifestGenre) {
  const { parsed, error } = extractJson(output.output ?? '');
  const result = {
    id: request.id,
    task: request.task,
    genreId: request.genreId,
    lengthTarget: request.lengthTarget,
    position: request.position,
    totalInputChars: request.totalInputChars,
    usage: output.usage ?? null,
    latencyMs: output.latencyMs ?? null,
    stopReason: output.stopReason ?? null,
    truncated: output.truncated === true,
    parseError: error,
    checks: [],
    semanticReview: []
  };
  if (error !== null) {
    result.checks.push({ kind: 'parse', label: 'JSON 可解析', pass: false, evidence: error });
    result.semanticReview = semanticEvidence(output.output ?? '', request.genreId);
    return result;
  }
  result.checks.push({ kind: 'parse', label: 'JSON 可解析', pass: true, evidence: 'ok' });
  result.checks = result.checks.concat(
    request.task === 'extract'
      ? scoreExtract(request.genreId, parsed, manifestGenre?.keyFacts?.prohibition?.forbiddenMarkers)
      : scorePlan(request.genreId, parsed, manifestGenre)
  );
  result.semanticReview = semanticEvidence(output.output ?? '', request.genreId);
  return result;
}

function loadOutputs(outputsDir) {
  if (!existsSync(outputsDir)) return new Map();
  const map = new Map();
  for (const file of readdirSync(outputsDir)) {
    if (file.endsWith('.output.json')) {
      const data = JSON.parse(readFileSync(join(outputsDir, file), 'utf8'));
      map.set(data.id, data);
    }
  }
  return map;
}

function aggregate(results) {
  const by = (key) => {
    const groups = {};
    for (const r of results) {
      const k = r[key];
      groups[k] ??= { total: 0, pass: 0, fails: [] };
      groups[k].total += 1;
      const failed = r.checks.filter((c) => !c.pass);
      if (failed.length === 0 && r.parseError === null) groups[k].pass += 1;
      else groups[k].fails.push({ id: r.id, failed: failed.map((c) => c.label) });
    }
    return groups;
  };
  return { byLength: by('lengthTarget'), byPosition: by('position'), byTask: by('task') };
}

function writeReport(outDir, results) {
  const failures = [];
  for (const r of results) {
    for (const c of r.checks) {
      if (!c.pass) failures.push({ id: r.id, kind: c.kind, label: c.label, evidence: c.evidence, missingGroups: c.missingGroups });
    }
  }
  const lines = [
    '# CTX-01 程序化评分报告',
    '',
    `评分时间：${new Date().toISOString()}`,
    `输出数：${results.length}`,
    '',
    '## 聚合（全部程序化检查通过的占比）',
    '',
    '### 按长度',
    ...Object.entries(aggregate(results).byLength).map(([k, g]) => `- ${k}：${g.pass}/${g.total} 全过`),
    '',
    '### 按位置',
    ...Object.entries(aggregate(results).byPosition).map(([k, g]) => `- ${k}：${g.pass}/${g.total} 全过`),
    '',
    '### 按任务',
    ...Object.entries(aggregate(results).byTask).map(([k, g]) => `- ${k}：${g.pass}/${g.total} 全过`),
    '',
    '## 未通过项明细',
    '',
    ...(failures.length === 0
      ? ['（无）']
      : failures.map((f) => `- [${f.id}] ${f.kind} ${f.label}：${f.evidence}${f.missingGroups ? `（缺失：${f.missingGroups.join('；')}）` : ''}`)),
    '',
    '## 语义复核队列（程序不判分，供独立核对者逐条给证据）',
    ''
  ];
  for (const r of results) {
    lines.push(`### ${r.id}`, `- 长度 ${r.lengthTarget} / 位置 ${r.position} / 任务 ${r.task}`);
    lines.push(`- 用量 ${JSON.stringify(r.usage)}，耗时 ${r.latencyMs}ms，stop=${r.stopReason}，截断=${r.truncated}`);
    if (r.semanticReview.length === 0) lines.push('- （无关键术语句）');
    else lines.push(...r.semanticReview.map((s) => `- 证据句：${s.slice(0, 160)}`));
    lines.push('');
  }
  writeFileSync(join(outDir, 'score-report.md'), lines.join('\n'));
}

function runSelfTest() {
  const { genre: xg } = { genre: null };
  let failed = 0;
  const expect = (name, cond) => {
    if (!cond) {
      failed += 1;
      console.error(`SELFTEST FAIL: ${name}`);
    } else {
      console.log(`SELFTEST ok: ${name}`);
    }
  };
  // 完美提取输出（玄幻题材）：全部应通过
  const perfectExtract = {
    authorRequirements: ['忆燃系统以驾驶者真实记忆为燃料，燃烧后记忆永久失去', '每一卷的结尾必须安排以珍贵记忆换取的胜利', '被燃烧的记忆必须在前文具体出现过'],
    prohibitions: ['禁止系统流：不得出现发布任务、发放奖励、属性面板的系统', '禁止以随身老爷爷、神秘声音等形式变相替代'],
    characterRelations: ['林昭与陆停云是同母异父的兄妹，两人均不知情', '全书前三分之二（第一、二卷）不得相认'],
    causalDependencies: ['白塔坠落必须由林昭燃烧与母亲的夏日记忆导致同步率骤降、机体失控直接引发，不得改为外部偷袭或设备故障'],
    aliases: ['青瓷是陆停云在军机处的行动代号', '鹤归是陆停云专属机体的机体名'],
    freedomAreas: ['军机处鸽派鹰派的派系斗争与配角支线可自由创作，但不得改变白塔坠落的既定因果，支线不超过单卷四分之一']
  };
  const baseReq = { id: 'selftest', task: 'extract', genreId: 'xuanhuan-mecha', lengthTarget: 15000, position: 'front', totalInputChars: 0 };
  let r = scoreOne(baseReq, { output: JSON.stringify(perfectExtract) }, null);
  expect('完美提取全过', r.checks.every((c) => c.pass));
  // 否定误读：系统流写进要求
  const misread = JSON.parse(JSON.stringify(perfectExtract));
  misread.authorRequirements.push('本书包含系统流设定');
  misread.prohibitions = ['禁止超能力'];
  r = scoreOne(baseReq, { output: JSON.stringify(misread) }, null);
  expect('否定误读被检出', r.checks.some((c) => c.kind === 'negation-misread' && !c.pass));
  // 关键事实遗漏：因果缺夏日记忆
  const omitCausal = JSON.parse(JSON.stringify(perfectExtract));
  omitCausal.causalDependencies = ['白塔坠落由机体失控引发，不得改为外部偷袭或设备故障'];
  r = scoreOne(baseReq, { output: JSON.stringify(omitCausal) }, null);
  expect('因果遗漏被检出', r.checks.some((c) => c.factId === 'CD-1' && c.kind === 'fact-coverage' && !c.pass));
  // 结构破坏
  r = scoreOne(baseReq, { output: '这不是JSON' }, null);
  expect('坏JSON被检出', r.parseError !== null);
  // 方案：违禁元素
  const badPlan = {
    premise: '主角获得一个发布任务的系统提示，在末日都市崛起',
    volumes: [
      { title: '卷一', summary: '林昭驾驶鹤归出击' },
      { title: '卷二', summary: '陆停云以青瓷代号行动' },
      { title: '卷三', summary: '白塔坠落前夜，记忆与燃料的抉择' }
    ],
    keyTurns: ['林昭与陆停云发现彼此'],
    compliance: { appliedRequirements: ['记忆为燃料'], avoidedProhibitions: ['避免了系统流'], usedAliases: ['青瓷', '鹤归'] }
  };
  const planReq = { ...baseReq, task: 'plan' };
  r = scoreOne(planReq, { output: JSON.stringify(badPlan) }, { keyFacts: { prohibition: { forbiddenMarkers: ['系统提示', '发布任务'] } } });
  expect('方案违禁元素被检出', r.checks.some((c) => c.kind === 'forbidden-element' && !c.pass));
  // 方案：合规输出应通过结构/违禁检查（要素覆盖由证据组判）
  const goodPlan = {
    premise: '以记忆为燃料的机甲世界，林昭在每卷结尾以记忆换取胜利，白塔坠落由夏日记忆的燃烧引发，林昭与陆停云的命运交织',
    volumes: [
      { title: '卷一', summary: '林昭入伍，记忆燃料的代价确立，卷末以记忆换取胜利' },
      { title: '卷二', summary: '陆停云以青瓷代号驾驶鹤归，夏日记忆被燃烧' },
      { title: '卷三', summary: '同步率骤降引发白塔坠落，兄妹暗线收束' }
    ],
    keyTurns: ['白塔坠落'],
    compliance: { appliedRequirements: ['每卷结尾记忆胜利'], avoidedProhibitions: ['未出现系统流'], usedAliases: ['青瓷', '鹤归'] }
  };
  r = scoreOne(planReq, { output: JSON.stringify(goodPlan) }, { keyFacts: { prohibition: { forbiddenMarkers: ['系统提示', '发布任务'] } } });
  expect('合规方案无违禁/结构错误', r.checks.every((c) => c.kind === 'forbidden-element' ? false : true) && r.checks.filter((c) => c.kind === 'forbidden-element').length === 0 && r.checks.find((c) => c.kind === 'structure').pass);
  if (failed > 0) {
    console.error(`SELFTEST: ${failed} 项失败`);
    process.exit(1);
  }
  console.log('SELFTEST: 全部通过');
}

function main() {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const evidenceDir = process.argv[2];
  if (!evidenceDir) throw new Error('用法：node score.mjs <evidence目录> [--selftest]');
  const manifest = JSON.parse(readFileSync(join(evidenceDir, 'manifest.json'), 'utf8'));
  const outputs = loadOutputs(join(evidenceDir, 'outputs'));
  const results = [];
  for (const sampleMeta of manifest.samples) {
    const output = outputs.get(sampleMeta.id);
    if (!output) continue;
    const request = JSON.parse(readFileSync(join(evidenceDir, 'samples', `${sampleMeta.id}.request.json`), 'utf8'));
    results.push(scoreOne(request, output, manifest.genres[request.genreId]));
  }
  writeFileSync(join(evidenceDir, 'score-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  writeReport(evidenceDir, results);
  const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
  const failedChecks = results.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0);
  console.log(`scored ${results.length} outputs, checks ${totalChecks}, failed ${failedChecks}`);
  console.log(`reports: ${join(evidenceDir, 'score-report.json')} / score-report.md`);
}

main();
