import { countNovelCharacters } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import type { ModelAdapter } from '../../apps/api/src/infrastructure/models/model-adapter.js';
import { ModelAdapterFactory } from '../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../apps/api/src/infrastructure/models/model-runtime-config.js';

const CHAPTER_SCENES = [
  { place: '结冰的北塔粮仓', lead: '林澈', goal: '抢在屋梁坍塌前找到被人撕走的出入账页', turn: '焦黑纸角显出一枚渡口水印' },
  { place: '涨水的芦苇渡口', lead: '林澈', goal: '辨认昨夜被人换过的缆绳结', turn: '无灯空船里传来导师惯用的敲击声' },
  { place: '封闭的旧城钟楼', lead: '林澈', goal: '穿过仍在转动的齿轮夹层取回报时簿', turn: '墙灰后露出指向北塔地下的排水图' },
  { place: '南城废弃染坊', lead: '林澈', goal: '在靛蓝废水淹没地窖前救出修钟匠的家人', turn: '染缸底部浮出刻着明日日期的铜牌' },
  { place: '暴雨中的城门甬道', lead: '林澈', goal: '阻止守军把无辜车夫当作内应处决', turn: '车轮夹层藏着一封尚未寄出的认罪信' }
] as const;

const ACTIONS = [
  '他先贴着潮湿墙面听脚步远近，没有急着碰那件最显眼的东西。',
  '同伴坚持先救被困的人，两人的争执被一声突然逼近的断裂声打断。',
  '追兵封住近路后，他只好用手边绳索换一条更慢却能保住众人的退路。',
  '陌生证人的说法前后矛盾，他把问题拆开追问，终于等到对方露出迟疑。',
  '灯火熄灭的一瞬，他闻到不属于现场的药油味，立刻改变原定方向。',
  '代价落在眼前：伤口重新裂开，唯一的照明也只够再撑片刻。'
] as const;

/** Only for engineering tests: each chapter is a distinct scene, never a production writer fallback. */
export function createDistinctNovelModelFactory(): ModelAdapterFactory {
  const baseFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}));
  return {
    resolve(provider: string, modelId: string, purpose: Parameters<ModelAdapterFactory['resolve']>[2], roleKey?: Parameters<ModelAdapterFactory['resolve']>[3]): ModelAdapter {
      if (purpose !== 'novel_writer') return baseFactory.resolve(provider, modelId, purpose, roleKey);
      return {
        provider,
        modelId,
        async generate(request) {
          const envelope = JSON.parse(request.prompt) as { chapterNumber?: number; taskInput?: { chapterNumber?: number } };
          const chapterNumber = envelope.taskInput?.chapterNumber ?? envelope.chapterNumber ?? 1;
          const output = buildDistinctTestNovel(chapterNumber);
          return { provider, modelId, output, inputTokens: 400, outputTokens: 1_600, cashCostCny: 0, state: 'succeeded' };
        }
      };
    }
  } as ModelAdapterFactory;
}

function buildDistinctTestNovel(chapterNumber: number): string {
  const scene = CHAPTER_SCENES[(chapterNumber - 1) % CHAPTER_SCENES.length]!;
  const paragraphs: string[] = [];
  let round = 0;
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_700) {
    const action = ACTIONS[round % ACTIONS.length]!;
    paragraphs.push(
      `${scene.place}里，${scene.lead}仍在设法${scene.goal}。${action}`
      + `这一次，他看到的尘土、听见的回声和同伴的反应都改变了下一步；第${round + 1}轮行动没有回到原点，而是把危险推向更近的人。`
    );
    round += 1;
  }
  paragraphs.push(`${scene.turn}。${scene.lead}把铜钥匙压在掌心，还没来得及解释，门外便有人叫出了只有失踪导师才知道的旧名。`);
  return paragraphs.join('\n\n');
}
