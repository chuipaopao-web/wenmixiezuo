#!/usr/bin/env node
// CTX-01 样本生成器：按题材 × 长度(15000/20000/30000) × 位置(前/中/后) 生成资料包与请求。
// 口径声明：
// - totalInputChars = system + user 原始字符串的 JS length（含标点，不含 JSON 转义与 HTTP 包装）；
// - effectiveBodyChars = 资料包正文（关键事实块+填充块，不含系统提示与任务指令模板）；
// - 填充块按 priority 贪心选取并做末块交换优化，使 totalInputChars 尽量贴近目标；
// - 同一题材三长度共享关键事实，填充为自然背景块的嵌套子集（15k⊂20k⊂30k），不重复；
// - 关键事实块按位置变体置于填充序列前/中/后；manifest 记录每条关键事实在 user 消息中的字符区间。
// 用法：node build-samples.mjs <输出目录>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { genre as xuanhuan } from './samples-data-xuanhuan.mjs';
import { genre as history } from './samples-data-history.mjs';
import { genre as urban } from './samples-data-urban.mjs';

const GENRES = [xuanhuan, history, urban];
const LENGTHS = [15000, 20000, 30000];
const POSITIONS = ['front', 'middle', 'back'];

const SYSTEM_PROMPT = '你是文秘写作平台的长篇小说策划助手。你会收到一本书的资料包（包含作者要求、世界观、人物、既有章节与创作规范），并依据资料包完成指定任务。你必须严格遵守资料包中的作者要求与否定条件，保持人物关系与因果设定一致。只输出任务要求的结构化内容，不输出思考过程。';

const TASKS = {
  extract: {
    instruction: '【任务：关键信息提取】\n请通读以下书籍资料包，提取六类关键信息，以 JSON 对象输出，字段为：authorRequirements（作者硬性要求）、prohibitions（否定条件，即明确禁止的内容）、characterRelations（人物关系）、causalDependencies（因果依赖）、aliases（别名对照）、freedomAreas（允许发挥区域）。各字段为字符串数组，每条完整复述资料包中的对应内容。只输出 JSON 对象，不要输出其他内容。\n\n【书籍资料包】\n',
    maxOutputTokens: 4000,
    thinking: { type: 'disabled' }
  },
  plan: {
    instruction: '【任务：故事方案设计】\n请依据以下书籍资料包，为本书设计短篇幅总体故事方案，以 JSON 对象输出，字段为：premise（主线梗概，200字以内）、volumes（三卷结构，数组，每项含 title 与 summary 两字段）、keyTurns（关键转折，字符串数组）、compliance（合规自查，对象，含 appliedRequirements、avoidedProhibitions、usedAliases 三个字符串数组）。方案必须遵守资料包中的全部作者要求与否定条件，不得违反人物关系与因果依赖，别名使用正确。只输出 JSON 对象。\n\n【书籍资料包】\n',
    maxOutputTokens: 6000,
    thinkingHeadroomTokens: 16000,
    thinking: { type: 'enabled', budget_tokens: 16000 }
  }
};

function keyBlockText(genre) {
  const k = genre.keyFacts;
  return [
    '【作者要求与关键设定】',
    `1. ${k.authorRequirement.text}`,
    `2. ${k.prohibition.text}`,
    `3. ${k.characterRelation.text}`,
    `4. ${k.causalDependency.text}`,
    `5. ${k.alias.text}`,
    `6. ${k.freedomArea.text}`
  ].join('\n');
}

function fillerSection(block) {
  return `【${block.title}】\n${block.text}`;
}

// 贪心选取 + 末块交换优化：在预算内使填充总长度最大化贴近预算
function selectFiller(blocks, budget) {
  const sorted = [...blocks].sort((a, b) => a.priority - b.priority);
  const selected = [];
  let total = 0;
  for (const block of sorted) {
    const len = fillerSection(block).length + 2; // 段落间 \n\n
    if (total + len <= budget) {
      selected.push(block);
      total += len;
    }
  }
  // 末块交换：尝试用未选块替换已选末块，缩小与预算的差
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = selected.length - 1; i >= 0 && i >= selected.length - 3; i--) {
      for (const cand of sorted) {
        if (selected.includes(cand)) continue;
        const candLen = fillerSection(cand).length + 2;
        const oldLen = fillerSection(selected[i]).length + 2;
        const newTotal = total - oldLen + candLen;
        if (newTotal <= budget && newTotal > total) {
          selected[i] = cand;
          total = newTotal;
          improved = true;
        }
      }
    }
  }
  return selected.sort((a, b) => a.priority - b.priority);
}

function assembleMaterial(genre, position, fillerBlocks) {
  const key = keyBlockText(genre);
  const sections = fillerBlocks.map(fillerSection);
  if (position === 'front') return [key, ...sections].join('\n\n');
  if (position === 'back') return [...sections, key].join('\n\n');
  const half = Math.ceil(sections.length / 2);
  return [...sections.slice(0, half), key, ...sections.slice(half)].join('\n\n');
}

function factOffsets(genre, userText) {
  const offsets = {};
  for (const [category, fact] of Object.entries(genre.keyFacts)) {
    const idx = userText.indexOf(fact.text);
    if (idx < 0) throw new Error(`关键事实未定位：${genre.id}/${fact.id}`);
    offsets[fact.id] = { category, start: idx, end: idx + fact.text.length };
  }
  return offsets;
}

function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('用法：node build-samples.mjs <输出目录>');
  const samplesDir = join(outDir, 'samples');
  mkdirSync(samplesDir, { recursive: true });

  const manifest = {
    schema: 'ctx01-manifest-v1',
    generatedAt: new Date().toISOString(),
    charCounting: 'totalInputChars=system与user原始字符串JS length（含标点，不含JSON转义）；effectiveBodyChars=资料包正文（关键事实块+填充块，不含系统提示与任务指令模板）',
    systemPrompt: SYSTEM_PROMPT,
    tasks: Object.fromEntries(Object.entries(TASKS).map(([k, v]) => [k, {
      instruction: v.instruction,
      maxOutputTokens: v.maxOutputTokens,
      thinking: v.thinking,
      ...(v.thinkingHeadroomTokens ? { thinkingHeadroomTokens: v.thinkingHeadroomTokens } : {})
    }])),
    lengths: LENGTHS,
    positions: POSITIONS,
    genres: {},
    samples: []
  };

  for (const genre of GENRES) {
    manifest.genres[genre.id] = {
      genreLabel: genre.genreLabel,
      bookTitle: genre.bookTitle,
      keyFacts: genre.keyFacts,
      fillerBlockCount: genre.fillerBlocks.length
    };
    for (const length of LENGTHS) {
      for (const position of POSITIONS) {
        const sampleId = `ctx01-${genre.id}-L${length}-P${position}`;
        const overhead = SYSTEM_PROMPT.length + keyBlockText(genre).length;
        // 两任务指令长度不同，按较长的 plan 指令卡预算，保证两种任务都不超目标
        const maxInstruction = Math.max(...Object.values(TASKS).map((t) => t.instruction.length));
        const fillerBudget = length - overhead - maxInstruction - 4;
        const filler = selectFiller(genre.fillerBlocks, fillerBudget);
        const material = assembleMaterial(genre, position, filler);
        const sample = {
          id: sampleId,
          genreId: genre.id,
          genreLabel: genre.genreLabel,
          bookTitle: genre.bookTitle,
          lengthTarget: length,
          position,
          fillerBlockIds: filler.map((b) => b.id),
          material,
          effectiveBodyChars: material.length
        };
        for (const [taskId, task] of Object.entries(TASKS)) {
          const user = task.instruction + material;
          const requestId = `${sampleId}-${taskId}`;
          const request = {
            id: requestId,
            sampleId,
            task: taskId,
            genreId: genre.id,
            lengthTarget: length,
            position,
            system: SYSTEM_PROMPT,
            user,
            totalInputChars: SYSTEM_PROMPT.length + user.length,
            effectiveBodyChars: material.length,
            keyFactOffsets: factOffsets(genre, user),
            modelParams: {
              model: 'deepseek-v4-pro',
              maxOutputTokens: task.maxOutputTokens,
              thinking: task.thinking,
              ...(task.thinkingHeadroomTokens
                ? { maxTokensWithHeadroom: task.maxOutputTokens + task.thinkingHeadroomTokens }
                : { maxTokensWithHeadroom: task.maxOutputTokens })
            }
          };
          writeFileSync(join(samplesDir, `${requestId}.request.json`), JSON.stringify(request, null, 2));
          manifest.samples.push({
            id: requestId,
            sampleId,
            task: taskId,
            genreId: genre.id,
            lengthTarget: length,
            position,
            totalInputChars: request.totalInputChars,
            effectiveBodyChars: material.length,
            deviationFromTarget: request.totalInputChars - length,
            keyFactOffsets: request.keyFactOffsets
          });
        }
        writeFileSync(join(samplesDir, `${sampleId}.material.json`), JSON.stringify(sample, null, 2));
      }
    }
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const genre of GENRES) {
    for (const length of LENGTHS) {
      const rows = manifest.samples.filter((s) => s.genreId === genre.id && s.lengthTarget === length && s.task === 'plan');
      const totals = rows.map((r) => r.totalInputChars);
      console.log(`${genre.id} L${length}: total=${totals.join('/')} (target ${length})`);
    }
  }
  console.log(`samples=${manifest.samples.length} requests written to ${samplesDir}`);
}

main();
