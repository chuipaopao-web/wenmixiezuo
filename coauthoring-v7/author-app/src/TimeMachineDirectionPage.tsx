import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon, ClockCounterClockwiseIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import {
  adoptTimeMachinePlan,
  fetchTimeMachineDirectionState,
  previewStorylineMaterial,
  retryTimeMachineRun,
  saveStorylineMaterial,
  saveStorylineMaterialDraft,
  saveTimeMachineCandidateRevision,
  startTimeMachineDesignRound,
  startTimeMachineRecommendation,
  timeMachineRunBusy,
  type StorylineMaterialContentInput,
  type StorylineMaterialContentView,
  type StorylineMaterialLineView,
  type StorylineMaterialPreviewView,
  type StorylineSelectionRequest,
  type TimeMachineDesignResultView,
  type TimeMachinePlanView,
  type TimeMachineRecommendationView,
  type TimeMachineStateView,
  type TimeMachineVolumeView
} from './time-machine-direction-api';
import { AuthorApiError } from './opening-api';
import { useAuthorAccount } from './AuthorAccountBoundary';
import { memberAvatarStyle } from './member-avatars';
import './time-machine-direction.css';

type Feedback = { tone: 'error' | 'info'; text: string } | null;

const SHAPE_OPTIONS: { value: 'auto' | 'single' | 'multiple'; title: string; desc: string }[] = [
  { value: 'auto', title: '由主编推荐', desc: '根据本书人物和想写的故事安排。' },
  { value: 'single', title: '集中讲一个核心故事', desc: '围绕一个主要追求，其他故事推动它。' },
  { value: 'multiple', title: '几个重要故事交织', desc: '多个目标相互影响，共同走向结局。' }
];

/** “＋ 添加其他故事线”弹窗的完整方向目录：作者从全部常见故事线方向中挑选，也可以完全自填。
 * 前三项保持原型既有文案逐字一致；目录只提供起点，作者可改可写，不与本书推荐混淆。 */
const ADD_LINE_PRESETS: { id: string; title: string; description: string }[] = [
  { id: 'romance', title: '感情线', description: '与拥有独立追求的伴侣，在合作与分歧中发展感情。' },
  { id: 'family', title: '亲情线', description: '从独自扛事，到重新拥有值得牵挂的家人。' },
  { id: 'rival', title: '宿敌线', description: '立场不同的对手，在反复交锋中改变彼此。' },
  { id: 'friendship', title: '友情线', description: '并肩同行的伙伴，在患难与选择中成为彼此的后盾。' },
  { id: 'mentor', title: '师徒线', description: '遇见引路人，或成为别人的引路人，在传承中走出自己的路。' },
  { id: 'revenge', title: '复仇线', description: '背负旧账出发，在追索真相中决定讨回还是放下。' },
  { id: 'mystery', title: '悬疑线', description: '一个绕不开的谜团，牵着所有人一步步接近真相。' },
  { id: 'adventure', title: '探险线', description: '前往未知的远方，在危险与奇遇中打开更大的世界。' },
  { id: 'building', title: '建设线', description: '从一无所有开始，亲手建起值得守护的家业或家园。' },
  { id: 'faction', title: '势力线', description: '经营自己的势力，在合纵连横中站稳并壮大。' },
  { id: 'identity', title: '身份线', description: '被隐藏的身世或马甲，一旦揭开就改变所有人的位置。' },
  { id: 'redemption', title: '救赎线', description: '弥补过去的错，在救赎别人的过程中放过自己。' },
  { id: 'guardian', title: '守护线', description: '为了想守住的人或物，一次次站出来变得更强。' },
  { id: 'competition', title: '竞逐线', description: '与同辈或强敌你追我赶，在较量中登上更高的位置。' }
];

function shapeLabelText(shape: 'auto' | 'single' | 'multiple'): string {
  return SHAPE_OPTIONS.find(option => option.value === shape)?.title ?? '由主编推荐';
}

function volumeLetter(index: number): string {
  let n = index + 1;
  let code = '';
  while (n > 0) { const rest = (n - 1) % 26; code = String.fromCharCode(65 + rest) + code; n = Math.floor((n - 1) / 26); }
  return code;
}

function roleLabel(role: string): string {
  if (role === 'main') return '主线';
  if (role === 'through') return '支线';
  return '阶段线';
}

function actionLabel(action: string): string {
  if (action === 'start') return '开启';
  if (action === 'advance') return '推进';
  if (action === 'pause') return '暂缓';
  return '收束';
}

function formatWords(target: number): string {
  if (target >= 10000) return `约${Math.round(target / 10000)}万字`;
  return `约${target}字`;
}

function isDesignResult(value: unknown): value is TimeMachineDesignResultView {
  return value !== null && typeof value === 'object' && 'candidateId' in value && 'plan' in value;
}

function isRecommendation(value: unknown): value is TimeMachineRecommendationView {
  return value !== null && typeof value === 'object' && 'greeting' in value && 'lines' in value;
}

/**
 * 服务端明确拒绝（4xx且不可重试）：结果确定、未创建设计轮，未决请求就此终结。
 * 网络/超时/5xx被request包装为retryable或status=0——结果未知，未决记录必须保留等原键重试。
 */
function definitiveFailure(error: unknown): boolean {
  return error instanceof AuthorApiError && error.status >= 400 && error.status < 500 && !error.retryable;
}

/** 时光机入口：重构后只保留新版全书方向（老板决定：旧版UI删除，全部走新后端）。 */
export function TimeMachineDirectionEntry({ bookId, onOpenSettings }: { bookId: string; onOpenSettings?: (() => void) | undefined }): React.JSX.Element {
  return <TimeMachineDirectionPage key={bookId} bookId={bookId} onOpenSettings={onOpenSettings} />;
}

function TimeMachineDirectionPage({ bookId, onOpenSettings }: { bookId: string; onOpenSettings?: (() => void) | undefined }): React.JSX.Element {
  const [state, setState] = useState<TimeMachineStateView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [selectedScheme, setSelectedScheme] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [authorNote, setAuthorNote] = useState('');
  const [shape, setShape] = useState<'auto' | 'single' | 'multiple'>('auto');
  const [ensemble, setEnsemble] = useState(true);
  const [addedLines, setAddedLines] = useState<typeof ADD_LINE_PRESETS>([]);
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  // 故事线推荐是首次进入时光机的落地页，不占导航；导航只列二级功能页。
  // S1-A阶段二（第25节）：二级导航为 全书｜时光树｜轨迹｜资料；故事线是"全书"的子步骤，资料页展示/编辑故事线资料。
  const [section, setSection] = useState<'landing' | 'plan' | 'material' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TimeMachinePlanView | null>(null);
  // 故事线资料编辑状态：m*为编辑中的草稿字段；materialPreview为确认前的影响预览
  const [materialEditing, setMaterialEditing] = useState(false);
  const [materialFromDraft, setMaterialFromDraft] = useState(false);
  const [mSelected, setMSelected] = useState<string[]>([]);
  const [mLines, setMLines] = useState<StorylineMaterialLineView[]>([]);
  const [mAdded, setMAdded] = useState<typeof ADD_LINE_PRESETS>([]);
  const [mShape, setMShape] = useState<'auto' | 'single' | 'multiple'>('auto');
  const [mEnsemble, setMEnsemble] = useState(true);
  const [mNote, setMNote] = useState('');
  const [materialPreview, setMaterialPreview] = useState<StorylineMaterialPreviewView | null>(null);
  const materialConfirmRef = useRef<HTMLDialogElement | null>(null);
  const materialSaveKey = useRef<string | null>(null);
  // 72c3a62f复核第2项：全书页确认时若故事线资料有改动，先走材料保存流，保存成功后用新资料版本自动开始设计
  const designAfterMaterialSave = useRef<{ selection: StorylineSelectionRequest; key: string; signature: string; content: StorylineMaterialContentInput } | null>(null);
  const recommendStarted = useRef(false);
  const initializedRecommendation = useRef<string | null>(null);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  // 账号隔离：未决记录键绑定已验证会话账号（AuthorAccountBoundary）+书籍，不读localStorage伪造身份。
  // 本组件只在AuthorApp（边界内）挂载；useAuthorAccount在无Provider时抛错，防止绕过账号接线。
  const { account } = useAuthorAccount();

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchTimeMachineDirectionState(bookId, signal);
      setState(next); setLoadFailed(false);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setLoadFailed(true);
    }
  }, [bookId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const anyBusy = state?.runs.some(timeMachineRunBusy) ?? false;
  useEffect(() => {
    const period = anyBusy ? 3000 : 15000;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, period);
    return () => window.clearInterval(timer);
  }, [anyBusy, refresh]);

  const runs = state?.runs ?? [];
  const recommendRun = useMemo(() => {
    const candidates = runs.filter(run => run.kind === 'recommend');
    if (candidates.length === 0) return null;
    const byLatest = (list: typeof candidates) => [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    // 有进行中的一轮就显示它；否则优先已成功的推荐——一次失败的重启不该把好的推荐盖成"未完成"。
    const active = candidates.find(run => timeMachineRunBusy(run) || run.state === 'queued');
    if (active !== undefined) return active;
    const succeeded = candidates.filter(run => run.state === 'succeeded');
    if (succeeded.length > 0) return byLatest(succeeded)[0] ?? null;
    return byLatest(candidates)[0] ?? null;
  }, [runs]);
  const designRuns = useMemo(() => runs.filter(run => run.kind === 'design'), [runs]);
  const latestRoundKey = useMemo(() => {
    if (designRuns.length === 0) return null;
    const latestAt = new Map<string, string>();
    for (const run of designRuns) {
      const key = run.roundKey ?? run.id;
      const prev = latestAt.get(key);
      if (prev === undefined || run.updatedAt > prev) latestAt.set(key, run.updatedAt);
    }
    let best: string | null = null; let bestAt = '';
    for (const [key, at] of latestAt) if (best === null || at > bestAt) { best = key; bestAt = at; }
    return best;
  }, [designRuns]);
  const roundRuns = useMemo(() => designRuns.filter(run => run.roundKey === latestRoundKey), [designRuns, latestRoundKey]);
  const roundActive = roundRuns.some(timeMachineRunBusy);
  const recommendBusy = recommendRun !== null && timeMachineRunBusy(recommendRun);
  // S1-A：刷新恢复——当轮设计已保存作者的实际选择；从最小投影恢复勾选/自添/备注，
  // 不把推荐里recommended的线重新当成作者已选。6ad621dd修正：
  //  - 恢复只做一次：按bookId+roundKey标记已恢复；作者dirty后不再重灌（后台轮询新建对象不再触发覆盖）
  //  - 来源一致性：旧设计的recommendationRunId不在当前推荐中时不把旧ID套到新推荐
  const restoredSelection = useMemo(() => {
    const withSelection = designRuns.filter(run => run.selection != null && run.roundKey === latestRoundKey);
    return withSelection.length > 0 ? withSelection[0]!.selection! : null;
  }, [designRuns, latestRoundKey]);
  const restoredRecommendation = useMemo(() => {
    if (restoredSelection?.recommendationRunId == null) return null;
    const run = runs.find(r => r.id === restoredSelection.recommendationRunId && r.kind === 'recommend');
    // 旧设计来源与新推荐不一致时不把旧ID当作新推荐（保留自添/备注，勾选留待作者重新核对）
    return run != null && run.id === recommendRun?.id ? run : null;
  }, [runs, restoredSelection, recommendRun?.id]);
  const restoredRound = useRef<string | null>(null);
  const authorDirty = useRef(false);
  useEffect(() => {
    if (restoredSelection === null || restoredRecommendation === null || latestRoundKey === null) return;
    const mark = `${bookId}:${latestRoundKey}`;
    if (restoredRound.current === mark || authorDirty.current) return;
    restoredRound.current = mark;
    initializedRecommendation.current = initializedRecommendation.current ?? restoredRecommendation.id;
    setSelectedLineIds(restoredSelection.selectedLineIds);
    setAddedLines(restoredSelection.addedLines.map(line => ({ id: `restored-${line.title}`, title: line.title, description: line.description })));
    setAuthorNote(restoredSelection.authorNote);
    setShape(restoredSelection.shape);
    setEnsemble(restoredSelection.ensemble);
  }, [restoredSelection, restoredRecommendation, latestRoundKey, bookId]);
  // S1-A阶段二（第25节）：故事线资料是作者确认的最新正式版本，初始化优先级高于当轮恢复——
  // 材料与最近轮不一致（作者已编辑保存）时从材料初始化；同样一次性、不覆盖dirty、来源需一致。
  const materialInit = useRef<string | null>(null);
  const storylineMaterial = state?.storylineMaterial ?? null;
  useEffect(() => {
    if (storylineMaterial === null || recommendRun === null) return;
    if (storylineMaterial.content.recommendationRunId !== recommendRun.id) return;
    const mark = `${bookId}:${storylineMaterial.revision}`;
    if (materialInit.current === mark || authorDirty.current) return;
    materialInit.current = mark;
    initializedRecommendation.current = initializedRecommendation.current ?? recommendRun.id;
    setSelectedLineIds(storylineMaterial.content.selectedLineIds);
    setAddedLines(storylineMaterial.content.addedLines.map(line => ({ id: `material-${line.title}`, title: line.title, description: line.description })));
    setAuthorNote(storylineMaterial.content.authorNote);
    setShape(storylineMaterial.content.shape);
    setEnsemble(storylineMaterial.content.ensemble);
  }, [storylineMaterial, recommendRun, bookId]);
  // 作者编辑即置dirty（恢复不得覆盖正在编辑的输入）
  useEffect(() => {
    const handler = () => { authorDirty.current = true; };
    window.addEventListener('input', handler, { capture: true });
    return () => window.removeEventListener('input', handler, { capture: true });
  }, []);
  useEffect(()=>{recommendStarted.current=false;},[state?.preparation?.version]);

  useEffect(() => {
    if (state === null || !state.enabled || state.preparation?.ready!==true || loadFailed) return;
    // 没有推荐运行就自动开一轮（含已有设计轮的旧书）：主编先给出推荐，再谈设计。
    if (recommendRun === null && !recommendStarted.current && (state.adopted === null || section === 'landing')) {
      recommendStarted.current = true;
      void (async () => {
        try { await startTimeMachineRecommendation(bookId, `recommend-initial:${bookId}:${state.preparation?.version}`); await refresh(); }
        catch (error) { setFeedback({ tone: 'error', text: error instanceof AuthorApiError ? error.message : '推荐尚未建立，请稍后重试' }); }
      })();
    }
  }, [state, loadFailed, recommendRun, bookId, refresh, section]);

  const recommendation = recommendRun !== null && isRecommendation(recommendRun.result) ? recommendRun.result : null;
  // 72c3a62f复核第1项：资料页改过的标题/描述在全书页同步显示（推荐原件不变，展示以正式资料为准）
  const landingLines = useMemo(() => {
    if (recommendation === null) return [];
    if (storylineMaterial === null || storylineMaterial.content.recommendationRunId !== recommendRun?.id) return recommendation.lines;
    return recommendation.lines.map(line => {
      const edited = storylineMaterial.content.selectedLines.find(item => item.id === line.id);
      return edited === undefined ? line : { ...line, title: edited.title, description: edited.description };
    });
  }, [recommendation, storylineMaterial, recommendRun?.id]);

  useEffect(() => {
    if (recommendation !== null && recommendRun && initializedRecommendation.current !== recommendRun.id) {
      initializedRecommendation.current = recommendRun.id;
      setSelectedLineIds(recommendation.lines.filter(line => line.recommended).map(line => line.id));
    }
  }, [recommendation, recommendRun]);

  useEffect(() => {
    if (selectedScheme === null) {
      const firstDone = roundRuns.find(run => run.state === 'succeeded' && isDesignResult(run.result));
      if (firstDone !== undefined) setSelectedScheme(firstDone.scheme ?? 'A');
    }
  }, [roundRuns, selectedScheme]);

  const selectedRun = roundRuns.find(run => run.scheme === selectedScheme) ?? null;
  const selectedResult = selectedRun !== null && isDesignResult(selectedRun.result) ? selectedRun.result : null;
  const adopted = state?.adopted ?? null;
  // 已采用方案的书直接进全书基线；其余书每次进入先见故事线推荐。
  const activeSection = section ?? (adopted !== null || designRuns.length > 0 ? 'plan' : 'landing');

  const runAction = async (action: () => Promise<unknown>, success?: () => void) => {
    if (busy) return;
    setBusy(true); setFeedback(null);
    try { await action(); await refresh(); success?.(); }
    catch (error) {
      setFeedback({ tone: 'error', text: error instanceof AuthorApiError ? error.message : '操作未能完成，已保留当前结果' });
    } finally { setBusy(false); }
  };

  // S1-A：结构化确认——键在一次提交开始时冻结，网络结果未知重试同请求同键；作者修改选择后才新键。
  // 6ad621dd修正F4：未决请求（完整selection+key）在发送前持久化到按账号/书籍隔离的sessionStorage；
  // 刷新/响应丢失后回填作者输入并用原请求原键重试；state中出现对应roundKey=确定成功，清除待发送记录。
  // 1dbed5cd复核：expectedMaterialRevision随请求一并冻结持久化；恢复重试必须原样带回，
  // 已有资料时漏传会被服务端版本门禁409拒绝。无材料首发保持缺省（不落该字段）。
  type PendingDesignRecord = { key: string; signature: string; selection: StorylineSelectionRequest; expectedMaterialRevision?: number };
  const designKey = useRef<string | null>(null);
  const designKeySignature = useRef<string | null>(null);
  const pendingDesign = useRef<StorylineSelectionRequest | null>(null);
  const pendingExpectedRevision = useRef<number | undefined>(undefined);
  const pendingRetryDone = useRef(false);
  const pendingRestored = useRef(false);
  const selectionSignature = useCallback((): string | null => {
    if (recommendRun === null || recommendationHashRef.current === null || state?.preparation?.version == null) return null;
    // 72c3a62f复核第1项：签名含勾选线正文（资料页可编辑），改标题/描述也会生成新键，不与旧请求混淆
    const lineTexts = selectedLineIds.map(id => {
      const kept = storylineMaterial?.content.selectedLines.find(item => item.id === id);
      return kept === undefined ? id : `${id}:${kept.title}:${kept.description}`;
    });
    return JSON.stringify([recommendRun.id, recommendationHashRef.current, state.preparation.version, selectedLineIds, lineTexts, addedLines.map(line => [line.title, line.description]), shape, ensemble, authorNote.trim()]);
  }, [recommendRun, selectedLineIds, addedLines, shape, ensemble, authorNote, state?.preparation?.version, storylineMaterial]);
  const recommendationHashRef = useRef<string | null>(null);
  useEffect(() => { recommendationHashRef.current = recommendRun?.recommendationHash ?? null; }, [recommendRun]);
  // 账号+书籍隔离的未决记录键；会话账号缺失时不落存储（退化为会话内useRef防重，不跨账号共享草稿）
  const pendingStorageKey = useCallback((): string | null => {
    return account.userId === '' ? null : `wenmi:design-pending:${account.userId}:${bookId}`;
  }, [account.userId, bookId]);
  const clearPendingRecord = useCallback(() => {
    const storageKey = pendingStorageKey();
    if (storageKey === null) return;
    try { window.sessionStorage.removeItem(storageKey); } catch { /* 清理失败不影响功能 */ }
  }, [pendingStorageKey]);
  // state中出现对应roundKey的设计轮=确定成功，清除待发送记录
  useEffect(() => {
    if (designKey.current === null) return;
    if (designRuns.some(run => run.roundKey === designKey.current)) clearPendingRecord();
  }, [designRuns, clearPendingRecord]);
  // 账号/书籍变化：重置恢复、dirty与未决引用并清空上个身份的输入，绝不重发上个账号/书籍的请求
  const identityRef = useRef(`${account.userId}:${bookId}`);
  useEffect(() => {
    const identity = `${account.userId}:${bookId}`;
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    restoredRound.current = null;
    authorDirty.current = false;
    pendingRestored.current = false;
    pendingRetryDone.current = false;
    designKey.current = null;
    designKeySignature.current = null;
    pendingDesign.current = null;
    pendingExpectedRevision.current = undefined;
    initializedRecommendation.current = null;
    materialInit.current = null;
    recommendStarted.current = false;
    setSelectedLineIds([]);
    setAddedLines([]);
    setAuthorNote('');
    setShape('auto');
    setEnsemble(true);
  }, [account.userId, bookId]);
  // 刷新后恢复未决请求：服务端已有该轮=确定成功只清理；否则回填作者输入（不触发input事件、不计dirty）
  useEffect(() => {
    if (pendingRestored.current || state === null) return;
    if (designKey.current !== null) { pendingRestored.current = true; return; }
    const storageKey = pendingStorageKey();
    if (storageKey === null) return; // 账号未就绪：不标记完成，待账号可用后再恢复
    pendingRestored.current = true;
    let pending: PendingDesignRecord;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw === null) return;
      pending = JSON.parse(raw) as PendingDesignRecord;
    } catch { return; /* 损坏的待发送记录按无未决处理 */ }
    if (typeof pending?.key !== 'string' || pending.key === '' || pending?.selection == null) return;
    designKey.current = pending.key;
    designKeySignature.current = pending.signature;
    if (state.runs.some(run => run.kind === 'design' && run.roundKey === pending.key)) {
      clearPendingRecord();
      return;
    }
    pendingDesign.current = pending.selection;
    // 恢复时只使用记录中冻结的版本号；记录缺省（无材料首发）保持undefined，绝不回填当前最新版本冒充原请求
    pendingExpectedRevision.current = typeof pending.expectedMaterialRevision === 'number' ? pending.expectedMaterialRevision : undefined;
    initializedRecommendation.current = initializedRecommendation.current ?? pending.selection.recommendationRunId;
    setSelectedLineIds(pending.selection.selectedLineIds);
    setAddedLines(pending.selection.addedLines.map(line => ({ id: `pending-${line.title}`, title: line.title, description: line.description })));
    setAuthorNote(pending.selection.authorNote);
    setShape(pending.selection.shape);
    setEnsemble(pending.selection.ensemble);
    setFeedback({ tone: 'info', text: '上次确认的结果未收到，已恢复你的选择并将用原请求重试，不会重复开任务。' });
  }, [state, pendingStorageKey, clearPendingRecord]);
  // 未决请求自动重试一次：来源仍一致且作者未修改时用原请求原键重发；收到明确失败回执则终结未决记录
  useEffect(() => {
    if (pendingDesign.current === null || pendingRetryDone.current || state === null || busy || anyBusy) return;
    if (authorDirty.current) return; // 作者已改选择：等其再次确认，签名不同自然另起新键新请求
    const selection = pendingDesign.current;
    const sourceValid = recommendRun !== null && recommendRun.id === selection.recommendationRunId
      && recommendRun.recommendationHash === selection.recommendationHash
      && state.preparation?.version === selection.preparationVersion
      && isRecommendation(recommendRun.result);
    if (!sourceValid) return; // 来源过期：保留自添/备注待作者重新核对，不自动替作者确认新推荐
    pendingRetryDone.current = true;
    // 1dbed5cd复核：重试必须原样带回冻结的expectedMaterialRevision——恢复期间资料已变更则由服务端409拒绝并终结未决，不自动改成新版本绕过作者确认
    void runAction(() => startTimeMachineDesignRound(bookId, selection, designKey.current!, pendingExpectedRevision.current).then(() => setSection('plan')).catch((error: unknown) => {
      if (definitiveFailure(error)) { pendingDesign.current = null; pendingExpectedRevision.current = undefined; clearPendingRecord(); }
      throw error; // 网络结果未知：保留未决记录，刷新或再点确认仍用原键原请求
    }));
  }, [state, busy, anyBusy, recommendRun, bookId, clearPendingRecord]);

  // 实际发送设计请求：持久化未决记录（响应未知/刷新后按原请求原键重试），4xx明确拒绝终结未决
  const sendDesignRequest = (selection: StorylineSelectionRequest, key: string, signature: string, expectedMaterialRevision?: number) => {
    pendingDesign.current = null;
    pendingExpectedRevision.current = undefined;
    pendingRetryDone.current = true; // 手动提交由本次交互反馈，不走挂载自动重试路径
    const storageKey = pendingStorageKey();
    if (storageKey !== null) {
      // 冻结完整请求（含expectedMaterialRevision）落盘：无材料首发为undefined，不落该字段保持缺省语义
      try { window.sessionStorage.setItem(storageKey, JSON.stringify({ key, signature, selection, ...(expectedMaterialRevision !== undefined ? { expectedMaterialRevision } : {}) } satisfies PendingDesignRecord)); } catch { /* 存储不可用时退化为会话内useRef防重 */ }
    }
    setSelectedScheme(null);
    void runAction(() => startTimeMachineDesignRound(bookId, selection, key, expectedMaterialRevision).then(() => setSection('plan')).catch((error: unknown) => {
      if (definitiveFailure(error)) clearPendingRecord(); // 服务端明确拒绝（4xx不可重试）：未决请求终结，不自动重试
      throw error;
    }));
  };

  const startDesign = () => {
    if (recommendation === null || anyBusy || busy) return;
    if (recommendRun === null || recommendRun.recommendationHash == null || state?.preparation?.version == null) {
      setFeedback({ tone: 'error', text: '推荐来源尚未就绪，请稍候或刷新页面后重试。' });
      return;
    }
    const selection: StorylineSelectionRequest = {
      recommendationRunId: recommendRun.id,
      recommendationHash: recommendRun.recommendationHash,
      preparationVersion: state.preparation.version,
      selectedLineIds,
      addedLines: addedLines.map(line => ({ title: line.title, description: line.description })),
      shape,
      ensemble,
      authorNote: authorNote.trim()
    };
    const signature = selectionSignature();
    if (signature === null) {
      setFeedback({ tone: 'error', text: '推荐来源尚未就绪，请稍候或刷新页面后重试。' });
      return;
    }
    if (designKey.current === null || designKeySignature.current !== signature) {
      designKey.current = `design:${bookId}:${Date.now()}`;
      designKeySignature.current = signature;
    }
    // 72c3a62f复核第2项：已有故事线资料时，设计必须基于当前正式资料版本，旧选择不能静默盖过新资料
    const material = storylineMaterial;
    if (material !== null) {
      // 勾选线正文以正式资料为准（资料页可编辑）；资料没有的线（新推荐里新勾的）取推荐原文
      const derivedLines = selectedLineIds.map(id => {
        const fromMaterial = material.content.selectedLines.find(item => item.id === id);
        if (fromMaterial !== undefined) return { id, title: fromMaterial.title, description: fromMaterial.description };
        const fromRecommendation = recommendation.lines.find(item => item.id === id);
        return { id, title: fromRecommendation?.title ?? '', description: fromRecommendation?.description ?? '' };
      }).filter(line => line.title !== ''); // 找不到正文的线不带覆盖，由服务端按推荐补齐或明确拒绝
      selection.selectedLines = derivedLines;
      const sourceMatches = material.content.recommendationRunId === recommendRun.id;
      const sameIds = material.content.selectedLineIds.length === selectedLineIds.length && material.content.selectedLineIds.every(id => selectedLineIds.includes(id));
      const sameTexts = sameIds && derivedLines.every(line => {
        const kept = material.content.selectedLines.find(item => item.id === line.id);
        return kept !== undefined && kept.title === line.title && kept.description === line.description;
      });
      const sameAdded = JSON.stringify(selection.addedLines) === JSON.stringify(material.content.addedLines);
      const unchangedSelection = sourceMatches && sameIds && sameTexts && sameAdded
        && shape === material.content.shape && ensemble === material.content.ensemble
        && authorNote.trim() === material.content.authorNote.trim();
      if (!unchangedSelection) {
        // 本次确认与正式资料不一致（或换了推荐来源）：先保存为新的资料版本，作者确认影响后自动开始设计
        const content: StorylineMaterialContentInput = {
          recommendationRunId: selection.recommendationRunId,
          recommendationHash: selection.recommendationHash,
          preparationVersion: selection.preparationVersion,
          selectedLineIds: [...selectedLineIds],
          selectedLines: derivedLines,
          addedLines: selection.addedLines,
          shape,
          ensemble,
          authorNote: authorNote.trim()
        };
        designAfterMaterialSave.current = { selection, key: designKey.current, signature, content };
        materialSaveKey.current = `material-edit:${bookId}:${Date.now()}`;
        void runAction(async () => {
          const preview = await previewStorylineMaterial(bookId, content, material.revision);
          if (preview.unchanged) {
            // 服务端判定与现资料一致：直接用当前资料版本开始设计
            const pending = designAfterMaterialSave.current;
            designAfterMaterialSave.current = null;
            if (pending !== null) sendDesignRequest(pending.selection, pending.key, pending.signature, material.revision);
            return;
          }
          setMaterialPreview(preview);
          materialConfirmRef.current?.showModal();
          setFeedback({ tone: 'info', text: '故事线资料将保存为新版本；请确认影响范围，保存后自动开始设计。' });
        });
        return;
      }
      sendDesignRequest(selection, designKey.current, signature, material.revision);
      return;
    }
    sendDesignRequest(selection, designKey.current, signature);
  };

  const retryRun = (runId: string) => { void runAction(() => retryTimeMachineRun(bookId, runId)); };

  /** 推荐失败（含重启后调用结果未确认）的恢复路径：以全新幂等键开一轮新推荐，旧运行与账本记录保留可核对。 */
  const restartRecommendation = () => {
    if (anyBusy || busy) return;
    recommendStarted.current = true;
    const intent = [authorNote.trim(), ...addedLines.map(line => `${line.title}：${line.description}`)].filter(Boolean).join('；');
    void runAction(() => startTimeMachineRecommendation(bookId, `recommend-restart:${bookId}:${Date.now()}`, intent));
  };

  const beginEdit = () => {
    if (selectedResult === null) return;
    setDraft(structuredClone(selectedResult.plan)); setEditing(true); setFeedback(null);
  };

  const saveEdit = () => {
    if (draft === null || selectedResult === null) return;
    void runAction(async () => {
      const saved = await saveTimeMachineCandidateRevision(bookId, selectedResult.candidateId, draft, selectedResult.revision);
      setEditing(false);
      setFeedback({ tone: 'info', text: `修改已保存为第${saved.revision}版，正在安排主编重新核查。` });
    });
  };

  const adopt = () => {
    if (selectedResult === null || selectedRun === null || state === null) return;
    const planRevision = state.planRevision;
    void runAction(async () => {
      await adoptTimeMachinePlan(bookId, { candidateId: selectedResult.candidateId, revision: selectedResult.revision, expectedRevision: planRevision, idempotencyKey: `adopt:${selectedResult.candidateId}:${selectedResult.revision}` });
      setFeedback({ tone: 'info', text: '已采用本方案作为全书方向。规划是后续卷链章设计的依据，不代表正文已经发生。' });
    });
  };

  const redesign = () => {
    // S1-A：重新设计=回到故事线确认；作者修改选择后确认时按签名变化自然生成新键
    designKey.current = null;
    designKeySignature.current = null;
    setSection('landing');
    setFeedback({ tone: 'info', text: '请确认这次想写的故事线，再开始设计。' });
  };

  // —— 故事线资料（S1-A阶段二，第25节）：展示/编辑/草稿/确认保存 ——
  const materialSourceRun = storylineMaterial !== null ? runs.find(run => run.id === storylineMaterial.content.recommendationRunId && run.kind === 'recommend') ?? null : null;
  const materialSourceRecommendation = materialSourceRun !== null && isRecommendation(materialSourceRun.result) ? materialSourceRun.result : null;
  const materialContentNow = (): StorylineMaterialContentInput | null => {
    if (storylineMaterial === null) return null;
    return {
      recommendationRunId: storylineMaterial.content.recommendationRunId,
      recommendationHash: storylineMaterial.content.recommendationHash,
      preparationVersion: storylineMaterial.content.preparationVersion,
      selectedLineIds: mSelected,
      // 72c3a62f复核第1项：勾选线正文随材料保存（作者可编辑标题/描述）；id稳定，role由服务端按原推荐裁定。
      // 只带前端已知正文的线（材料自含）；缺省的由服务端从原推荐补齐，绝不伪造空文本。
      selectedLines: mLines.filter(line => mSelected.includes(line.id)).map(line => ({ id: line.id, title: line.title.trim(), description: line.description.trim() })),
      addedLines: mAdded.map(line => ({ title: line.title, description: line.description })),
      shape: mShape,
      ensemble: mEnsemble,
      authorNote: mNote.trim()
    };
  };
  const beginMaterialEdit = () => {
    if (storylineMaterial === null) return;
    const draftContent = storylineMaterial.draft?.content;
    const fromDraft = draftContent !== null && draftContent !== undefined && typeof draftContent === 'object' && Array.isArray((draftContent as { selectedLineIds?: unknown }).selectedLineIds);
    const source = fromDraft ? draftContent as StorylineMaterialContentView : storylineMaterial.content;
    // 旧草稿可能还没有selectedLines（72c3a62f前形成）：正文退回当前材料自含内容，不从最新推荐倒灌
    const sourceLines = Array.isArray(source.selectedLines) && source.selectedLines.length > 0 ? source.selectedLines : storylineMaterial.content.selectedLines;
    setMSelected([...source.selectedLineIds]);
    setMLines(sourceLines.map(line => ({ ...line })));
    setMAdded(source.addedLines.map(line => ({ id: `edit-${line.title}`, title: line.title, description: line.description })));
    setMShape(source.shape);
    setMEnsemble(source.ensemble);
    setMNote(source.authorNote);
    setMaterialFromDraft(fromDraft);
    setMaterialPreview(null);
    materialSaveKey.current = null;
    designAfterMaterialSave.current = null;
    setMaterialEditing(true);
    setFeedback(fromDraft ? { tone: 'info', text: '已恢复上次未保存的草稿。' } : null);
  };
  const cancelMaterialEdit = () => { setMaterialEditing(false); setMaterialPreview(null); setMaterialFromDraft(false); materialSaveKey.current = null; };
  const saveMaterialDraftNow = () => {
    if (storylineMaterial === null) return;
    const content = materialContentNow();
    if (content === null) return;
    void runAction(async () => {
      await saveStorylineMaterialDraft(bookId, content, storylineMaterial.revision);
      setFeedback({ tone: 'info', text: '草稿已保存；正式资料与后续设计不受影响。' });
    });
  };
  // 保存修改→影响预览→确认弹窗；幂等键在一次保存流程开始时冻结，结果未知重试同键
  const requestMaterialSave = () => {
    if (storylineMaterial === null) return;
    const content = materialContentNow();
    if (content === null) return;
    if (content.selectedLineIds.length + content.addedLines.length === 0) { setFeedback({ tone: 'error', text: '请至少选择或添加一条故事线' }); return; }
    if (materialSaveKey.current === null) materialSaveKey.current = `material-edit:${bookId}:${Date.now()}`;
    void runAction(async () => {
      const preview = await previewStorylineMaterial(bookId, content, storylineMaterial.revision);
      if (preview.unchanged) { setFeedback({ tone: 'info', text: '内容与当前资料一致，无需保存。' }); return; }
      setMaterialPreview(preview);
      materialConfirmRef.current?.showModal();
    });
  };
  // 72c3a62f复核第3项：预览签名原样带回、服务端事务内重算；预览后下游/资料版本变化→409零写入，
  // 前端刷新后重新生成预览，请作者按最新影响再次确认。全书页接力（designAfterMaterialSave）保存成功后自动开始设计。
  const confirmMaterialSave = () => {
    if (storylineMaterial === null) return;
    const pendingDesignStart = designAfterMaterialSave.current;
    const content = pendingDesignStart !== null ? pendingDesignStart.content : materialContentNow();
    if (content === null || materialSaveKey.current === null || materialPreview === null) return;
    materialConfirmRef.current?.close();
    const baseRevision = storylineMaterial.revision;
    const previewSignature = materialPreview.signature;
    void (async () => {
      if (busy) return;
      setBusy(true); setFeedback(null);
      try {
        const saved = await saveStorylineMaterial(bookId, { content, expectedRevision: baseRevision, previewSignature, idempotencyKey: materialSaveKey.current! });
        await refresh();
        setMaterialEditing(false); setMaterialPreview(null); setMaterialFromDraft(false);
        materialSaveKey.current = null;
        materialInit.current = `${bookId}:${saved.projection.revision}`;
        // 这就是作者刚保存的正式内容：同步全书页确认区，不视为dirty覆盖
        setSelectedLineIds(saved.projection.content.selectedLineIds);
        setAddedLines(saved.projection.content.addedLines.map(line => ({ id: `material-${line.title}`, title: line.title, description: line.description })));
        setAuthorNote(saved.projection.content.authorNote);
        setShape(saved.projection.content.shape);
        setEnsemble(saved.projection.content.ensemble);
        setFeedback({ tone: 'info', text: saved.unchanged ? '内容与当前资料一致，无需保存。' : `已保存为第${saved.projection.revision}版故事线资料；基于旧版资料的${saved.markedRuns}套设计已标记需重新设计，旧结果保留可查看。` });
        if (pendingDesignStart !== null) {
          designAfterMaterialSave.current = null;
          // 全书页确认接力：资料新版本落库后，用新资料版本开始设计（同样走未决记录持久化）
          pendingDesign.current = null;
          pendingExpectedRevision.current = undefined;
          pendingRetryDone.current = true;
          const storageKey = pendingStorageKey();
          if (storageKey !== null) {
            // 1dbed5cd复核：接力请求基于刚保存的资料新版本，版本号一并冻结落盘；刷新重试原样带回
            try { window.sessionStorage.setItem(storageKey, JSON.stringify({ key: pendingDesignStart.key, signature: pendingDesignStart.signature, selection: pendingDesignStart.selection, expectedMaterialRevision: saved.projection.revision } satisfies PendingDesignRecord)); } catch { /* 存储不可用时退化为会话内useRef防重 */ }
          }
          setSelectedScheme(null);
          try {
            await startTimeMachineDesignRound(bookId, pendingDesignStart.selection, pendingDesignStart.key, saved.projection.revision);
            await refresh();
            setSection('plan');
          } catch (designError) {
            if (definitiveFailure(designError)) clearPendingRecord();
            setFeedback({ tone: 'error', text: designError instanceof AuthorApiError ? designError.message : '资料已保存，但设计未能开始，请在「全书」再次确认。' });
          }
        }
      } catch (error) {
        if (error instanceof AuthorApiError && error.status === 409) {
          try {
            const fresh = await fetchTimeMachineDirectionState(bookId);
            setState(fresh); setLoadFailed(false);
            const freshMaterial = fresh.storylineMaterial ?? null;
            if (freshMaterial === null) { designAfterMaterialSave.current = null; setMaterialEditing(false); setFeedback({ tone: 'error', text: '故事线资料状态已变化，请重新开始修改。' }); return; }
            const freshPreview = await previewStorylineMaterial(bookId, content, freshMaterial.revision);
            if (freshPreview.unchanged) {
              setMaterialEditing(false); setMaterialPreview(null); designAfterMaterialSave.current = null;
              setFeedback({ tone: 'info', text: '内容与当前资料一致，无需保存。' });
              return;
            }
            setMaterialPreview(freshPreview);
            materialConfirmRef.current?.showModal();
            setFeedback({ tone: 'info', text: '影响范围刚刚发生变化，已按最新状态更新预览，请再次确认。' });
          } catch (retryError) {
            setFeedback({ tone: 'error', text: retryError instanceof AuthorApiError ? retryError.message : '操作未能完成，已保留当前结果' });
          }
        } else {
          setFeedback({ tone: 'error', text: error instanceof AuthorApiError ? error.message : '操作未能完成，已保留当前结果' });
        }
      } finally { setBusy(false); }
    })();
  };

  // “＋ 添加其他故事线”弹窗由全书确认区与资料编辑共用：加入目标随上下文切换（编辑资料时加入资料草稿）
  const lineAddTarget = materialEditing ? mAdded : addedLines;
  const addLineToContext = (line: { id: string; title: string; description: string }) => {
    if (materialEditing) setMAdded(prev => prev.some(item => item.id === line.id) ? prev : [...prev, line]);
    else setAddedLines(prev => prev.some(item => item.id === line.id) ? prev : [...prev, line]);
  };

  if (state === null) {
    return (
      <div className="tmd-shell">
        {loadFailed
          ? <div className="tmd-load-failure"><strong>时光机暂时打不开</strong><span>可能是网络问题；已完成的方案不会丢失。</span><button type="button" onClick={() => void refresh()}>重试</button></div>
          : <div className="tmd-loading">正在打开时光机……</div>}
      </div>
    );
  }

  if (state.preparation?.ready!==true) {
    return <div className="tmd-shell"><div className="tmd-panel"><h2>先完成本书设定</h2><p>{state.preparation?.message??'正在核对设定准备情况，请稍后刷新。'}</p><p>设定确认并由主编统一整理后，再整理资料、推荐故事线。</p>{onOpenSettings&&<button type="button" className="tmd-primary" onClick={onOpenSettings}>返回设定</button>}</div></div>;
  }
  if (!state.enabled) {
    return (
      <div className="tmd-shell">
        <div className="tmd-panel">
          <h2>全书方向</h2>
          <p>新版时光机正在接入成员与模型配置，暂时还不能开始设计。已确认的开书和设定资料不会受影响。</p>
          {onOpenSettings !== undefined && <button type="button" onClick={onOpenSettings}>查看资料</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="tmd-shell">
      <nav className="workspace-secondary-tabs tmd-navigation" aria-label="时光机功能">
        <button type="button" className={activeSection === 'landing' || activeSection === 'plan' ? 'active' : ''} aria-pressed={activeSection === 'landing' || activeSection === 'plan'} onClick={() => setSection(adopted !== null || designRuns.length > 0 ? 'plan' : 'landing')}>全书</button>
        <button type="button" disabled title="尚未开放">时光树</button>
        <button type="button" disabled title="尚未开放">轨迹</button>
        <button type="button" className={activeSection === 'material' ? 'active' : ''} aria-pressed={activeSection === 'material'} onClick={() => setSection('material')}>资料</button>
      </nav>

      <div className="tmd-content">
      {feedback !== null && <div className={feedback.tone === 'error' ? 'tmd-error' : 'tmd-info'}>{feedback.text}</div>}
      {loadFailed && <div className="tmd-error" role="alert">状态刷新失败，以下是上次读取的结果。<button type="button" className="tmd-add-line" onClick={()=>void refresh()}>重试读取</button></div>}

      {activeSection === 'plan' && (
        <button type="button" className="tmd-back" onClick={() => setSection('landing')}>‹ 返回故事线推荐</button>
      )}

      {activeSection === 'plan' && adopted !== null && (
        <section className="tmd-panel tmd-adopted">
          <div className="tmd-adopted-head">
          <CheckCircleIcon weight="fill" />
            <div>
              <strong>已采用 · {adopted.member.name} 的方案</strong>
              <span>
                {adopted.numbering !== null
                  ? `${adopted.numbering.volumes.map(v => `卷${v.code}`).join('、')}；${[...adopted.numbering.mainLines, ...adopted.numbering.branchLines].join('、')}`
                  : `${adopted.plan.volumes.length}卷规划`}
                ，全书{formatWords(adopted.plan.words.target)}
              </span>
            </div>
          </div>
          <details className="tmd-adopted-details"><summary>查看已采用的全书方向</summary><PlanDetail plan={adopted.plan} numbering={adopted.numbering} /></details>
          {adopted.needsRedesign === true && <div className="tmd-stale" role="status">基于旧版故事线资料，需重新设计。已采用的规划保留可查看，不会自动覆盖。</div>}
          <div className="tmd-actions">
            <button type="button" disabled={busy || roundActive} onClick={redesign}>重新设计全书方向</button>
            <button type="button" disabled={busy || roundActive} onClick={()=>setSection('landing')}>调整故事线</button>
          </div>
          <p className="tmd-note">下方仍可查看最近一轮的方案对比；重新设计并采用新方案后，这里的规划会更新，历史结果保留可回看。</p>
        </section>
      )}

      {activeSection === 'landing' && (
        <section className="tmd-section">
          {(recommendBusy || recommendRun === null) && (
            <div className="tmd-welcome tmd-working" role="status">
              <span className="tmd-avatar-lg" style={memberAvatarStyle('chief-deepseek-v4-pro')} aria-hidden="true" />
              <div>
                <div className="tmd-eyebrow">貂蝉 · 主编</div>
                <p>老板，欢迎来到时光机。我们一起设计全书故事。</p>
                <p className="tmd-wait-note">{feedback?.tone === 'error' && recommendRun === null ? '这次未能启动，请重试。' : '正在整理本书故事线，请您耐心等待。'}</p>
                {recommendRun && <small>{recommendRun.progress}</small>}
                {recommendBusy && <small>推荐在后台进行，你可以离开本页；完成后结果保留，回来继续查看。</small>}
                {feedback?.tone === 'error' && recommendRun === null && <button type="button" className="tmd-restart" disabled={busy} onClick={restartRecommendation}>重新启动</button>}
              </div>
              <ClockCounterClockwiseIcon className="spin" />
            </div>
          )}
          {recommendRun !== null && recommendRun.state === 'failed' && (
            <div className="tmd-welcome tmd-failed">
              <span className="tmd-avatar-lg" style={memberAvatarStyle(recommendRun.member?.id ?? 'chief-deepseek-v4-pro')} aria-hidden="true" />
              <div>
                <div className="tmd-eyebrow">{recommendRun.member !== null ? `${recommendRun.member.name} · 编辑部` : '貂蝉 · 主编'}</div>
                <p>
                  <span>{recommendRun.message ?? '这次推荐没有完成，推荐记录已保留。'}</span>
                  <br />
                  <span>开书资料和已确认设定仍然保留，无需重新填写。</span>
                </p>
                <button type="button" className="tmd-restart" disabled={busy} onClick={restartRecommendation}>{busy ? '正在启动…' : '重新开始推荐'}</button>
              </div>
            </div>
          )}
          {recommendation !== null && (
            <>
              <div className="tmd-welcome">
                <span className="tmd-avatar-lg" style={memberAvatarStyle(recommendRun?.member?.id ?? 'chief-deepseek-v4-pro')} aria-hidden="true" />
                <div>
                  <div className="tmd-eyebrow">貂蝉 · 主编</div>
                  <p><span>老板，我们来设计全书骨架。</span><br /><span>这是我推荐的故事线，您看看，还想加入哪些？</span></p>
                </div>
              </div>
              <section className="tmd-block">
                <h3 className="tmd-section-title">你希望故事怎样展开？</h3>
                <div className="tmd-shape-grid" role="radiogroup" aria-label="故事展开方式">
                  {SHAPE_OPTIONS.map(option => (
                    <label key={option.value} className={`tmd-choice${shape === option.value ? ' selected' : ''}`}>
                      <input type="radio" name="tmd-shape" checked={shape === option.value} onChange={() => setShape(option.value)} />
                      <span>
                        <strong>{option.title}</strong>
                        <small>{option.desc}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <label className={`tmd-choice tmd-choice-wide${ensemble ? ' selected' : ''}`}>
                  <input type="checkbox" checked={ensemble} onChange={event => setEnsemble(event.target.checked)} />
                  <span>
                    <strong>也希望配角拥有自己的完整故事</strong>
                    <small>让重要人物有自己的追求，他们的选择会影响全书。</small>
                  </span>
                </label>
              </section>
              <section className="tmd-block">
                <div className="tmd-row">
                  <h2 className="tmd-section-title-lg">为本书推荐</h2>
                  <button type="button" className="tmd-add-line" disabled={busy || anyBusy} onClick={restartRecommendation}>请主编重新推荐</button>
                  <button type="button" className="tmd-add-line" onClick={() => addDialogRef.current?.showModal()}>＋ 添加其他故事线</button>
                </div>
                <div className="tmd-line-grid">
                  {landingLines.map(line => (
                    <label key={line.id} className={`tmd-line-card${selectedLineIds.includes(line.id) ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedLineIds.includes(line.id)}
                        onChange={event => setSelectedLineIds(prev => event.target.checked ? [...prev, line.id] : prev.filter(id => id !== line.id))}
                      />
                      <span>
                        <strong>{line.title}</strong>
                        <small>{line.description}</small>
                      </span>
                    </label>
                  ))}
                  {addedLines.map(line => (
                    <label key={`added-${line.id}`} className="tmd-line-card selected">
                      <input type="checkbox" checked onChange={() => setAddedLines(prev => prev.filter(item => item.id !== line.id))} />
                      <span>
                        <strong>{line.title}</strong>
                        <small>{line.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
              <div className="tmd-tail">
                <h3 className="tmd-section-title">还有想加入的故事吗？</h3>
                <textarea
                  className="tmd-custom-line"
                  value={authorNote}
                  aria-label="故事线补充要求"
                  maxLength={1200}
                  onChange={event => setAuthorNote(event.target.value)}
                  rows={3}
                  placeholder="写下想加入的人物关系、故事目标，或希望主编调整的方向。"
                />
                <div className="tmd-footer">
                  <small>已选 {selectedLineIds.length + addedLines.length} 条故事线</small>
                  <button type="button" className="tmd-primary" disabled={busy || anyBusy || selectedLineIds.length + addedLines.length === 0} onClick={startDesign}>确认故事线，设计全书方向</button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {activeSection === 'plan' && roundRuns.length > 0 && (
        <section className="tmd-panel tmd-design-workspace" aria-label="全书方案">
          <div className="tmd-plan-head">
            <div><h2>全书方向</h2><p className="tmd-note">{roundActive ? '各方案独立进行，完成后可以查看和比较。' : roundRuns.every(run => run.state === 'failed') ? '本轮设计未完成。故事线和已有工作记录已保留。' : '选择一个方案查看内容，确认后再采用。'}</p></div>
            <button type="button" className="tmd-ghost" onClick={() => setSection('material')}>查看故事线资料</button>
          </div>
          {storylineMaterial !== null && <details className="tmd-material-summary tmd-design-input">
            <summary>已确认的故事线与要求 · 第{storylineMaterial.revision}版</summary>
            <ul>{[...storylineMaterial.content.selectedLines, ...storylineMaterial.content.addedLines].map((line, index) => <li key={index}><strong>{line.title}</strong><p>{line.description}</p></li>)}</ul>
            {storylineMaterial.content.authorNote && <p>补充要求：{storylineMaterial.content.authorNote}</p>}
            <p>这是当前资料；标为需重新设计的旧方案仍保留原有内容。</p>
          </details>}
          {roundActive && <div className="tmd-work-notice" role="status"><ClockCounterClockwiseIcon aria-hidden="true" /><div><p>工作正在进行中，您可以退出等待，过几分钟后再回来查看。</p><small>让故事慢慢成形，新的可能正在酝酿。你可以离开本页，结果会保留。</small></div></div>}
          <div className="tmd-scheme-grid">
            {['A', 'B', 'C'].map(scheme => {
              const run = roundRuns.find(item => item.scheme === scheme);
              if (run === undefined) return null;
              const result = isDesignResult(run.result) ? run.result : null;
              // 只在真实工作中显示接手者；候选作者与当前审查成员不是同一个概念。
              const member = run.state === 'working' ? run.member : run.state === 'queued' ? null : result?.member ?? null;
              const status = run.state === 'working' ? '正在工作' : run.state === 'queued' ? '等待开始' : run.state === 'failed' ? '未完成' : result?.review.pass === true ? '可查看方案' : '待调整';
              return (
                <article key={scheme} className={`tmd-scheme-slot${run.state === 'failed' ? ' failed' : ''}`} aria-label={`方案${scheme}`}>
                <button type="button" disabled={editing || busy} aria-pressed={selectedScheme===scheme} className={`tmd-scheme-card${selectedScheme === scheme ? ' selected' : ''}`} onClick={() => setSelectedScheme(scheme)}>
                  <span className="tmd-scheme-heading"><span className="tmd-scheme-tag">方案{scheme}</span><span className={`tmd-scheme-state state-${run.state}`}>{status}</span></span>
                  {member !== null && <span className="tmd-scheme-member"><span className="tmd-scheme-avatar" style={memberAvatarStyle(member.id)} aria-hidden="true" /><strong>{member.name}</strong></span>}
                  {member === null && <span className="tmd-note">{run.state === 'failed' ? '本次设计已停止' : run.state === 'queued' ? '开始后会显示负责成员' : '成员接手信息正在同步'}</span>}
                  {run.needsRedesign === true && <span className="tmd-stale-tag">需重新设计</span>}
                </button>
                {run.state === 'working' && <progress className="tmd-work-progress" aria-label={`方案${scheme}正在工作`} />}
                {run.state === 'failed' && <div className="tmd-scheme-recovery"><p>{run.message ?? '本次工作没有完成，已保存的内容仍可保留。'}</p>{run.needsRedesign === true
                  ? <button type="button" className="tmd-ghost" onClick={() => setSection('material')}>查看资料并重新设计</button>
                  : <button type="button" className="tmd-ghost" aria-label={`继续方案${scheme}`} disabled={busy || editing} onClick={()=>retryRun(run.id)}>继续设计</button>}</div>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {activeSection === 'plan' && selectedResult !== null && selectedRun !== null && (
        <section className="tmd-panel">
          <div className="tmd-plan-head">
            <h3>方案{selectedRun.scheme} · {selectedResult.member.name} · 第{selectedResult.revision}版</h3>
            <div className="tmd-actions">
              {editing
                ? <>
                    <button type="button" className="tmd-primary" disabled={busy} onClick={saveEdit}>保存修改</button>
                    <button type="button" className="tmd-ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(null); }}>取消</button>
                  </>
                : <button type="button" disabled={busy || timeMachineRunBusy(selectedRun) || selectedRun.needsRedesign === true} onClick={beginEdit}><PencilSimpleIcon /> 修改方案</button>}
              <button type="button" className="tmd-primary" disabled={busy || editing || timeMachineRunBusy(selectedRun) || selectedRun.needsRedesign === true || selectedResult.review.pass !== true} onClick={adopt}>采用本方案</button>
            </div>
          </div>
          {selectedRun.needsRedesign === true && <div className="tmd-stale" role="status">本方案基于旧版故事线资料，需重新设计；结果保留可查看。</div>}
          {selectedResult.review.pass !== true && <div className="tmd-error">{timeMachineRunBusy(selectedRun) ? '修改已保存，主编正在核查这一版，完成后可以采用。' : '方案仍有待核对的问题，暂不能采用。'}{selectedResult.review.issues.map((issue,index)=><p key={index}>{issue}</p>)}</div>}
          {selectedResult.review.suggestions.length > 0 && (
            <details className="tmd-suggestions">
              <summary>主编文学建议（{selectedResult.review.suggestions.length}条，不阻断采用）</summary>
              <ul>{selectedResult.review.suggestions.map((text, index) => <li key={index}>{text}</li>)}</ul>
            </details>
          )}
          {editing && draft !== null
            ? <PlanEditor plan={draft} onChange={setDraft} />
            : <PlanDetail plan={selectedResult.plan} numbering={null} />}
        </section>
      )}

      {activeSection === 'material' && (
        <section className="tmd-panel tmd-material">
          <h3>故事线资料</h3>
          {storylineMaterial === null ? (
            <div className="tmd-material-empty">
              <p>本书还没有故事线资料。</p>
              <p>故事线资料在你确认故事线后形成：先在「全书」里请主编推荐并确认故事线。</p>
              <button type="button" className="tmd-primary" onClick={() => setSection('landing')}>去确认故事线</button>
            </div>
          ) : materialEditing ? (
            <div className="tmd-material-edit">
              {materialFromDraft && <p className="tmd-note">正在继续上次未保存的草稿；「取消」会丢弃这些未保存改动。</p>}
              <section className="tmd-block">
                <h4 className="tmd-section-title">主编推荐的故事线（勾选保留，可直接修改）</h4>
                {/* 72c3a62f复核第1项：标题/描述可直接编辑，稳定id；role由服务端按原推荐裁定，前端只读展示 */}
                {mLines.map((line, index) => (
                  <div key={line.id} className="tmd-material-added">
                    <label className={`tmd-line-card${mSelected.includes(line.id) ? ' selected' : ''}`}>
                      <input type="checkbox" checked={mSelected.includes(line.id)} onChange={event => setMSelected(prev => event.target.checked ? [...prev, line.id] : prev.filter(id => id !== line.id))} />
                      <span><strong>{roleLabel(line.role)}</strong></span>
                    </label>
                    <label>故事线名称<input aria-label={`推荐故事线${index + 1}名称`} value={line.title} maxLength={80} onChange={event => setMLines(prev => prev.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></label>
                    <label>想写怎样的故事<textarea aria-label={`推荐故事线${index + 1}描述`} rows={2} maxLength={500} value={line.description} onChange={event => setMLines(prev => prev.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></label>
                  </div>
                ))}
                <p className="tmd-note">标题与描述可直接修改，保存后形成新的正式版本；主编推荐原件保留在推荐记录中不变。取消勾选的线不会进入新版本。</p>
              </section>
              <section className="tmd-block">
                <h4 className="tmd-section-title">你添加的故事线</h4>
                {mAdded.map((line, index) => (
                  <div key={line.id} className="tmd-material-added">
                    <label>故事线名称<input aria-label={`自添故事线${index + 1}名称`} value={line.title} maxLength={80} onChange={event => setMAdded(prev => prev.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></label>
                    <label>想写怎样的故事<textarea aria-label={`自添故事线${index + 1}描述`} rows={2} maxLength={500} value={line.description} onChange={event => setMAdded(prev => prev.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></label>
                    <button type="button" onClick={() => setMAdded(prev => prev.filter((_, i) => i !== index))}>移除</button>
                  </div>
                ))}
                <button type="button" className="tmd-add-line" onClick={() => addDialogRef.current?.showModal()}>＋ 添加其他故事线</button>
              </section>
              <section className="tmd-block">
                <h4 className="tmd-section-title">故事展开方式</h4>
                <div className="tmd-shape-grid" role="radiogroup" aria-label="资料故事展开方式">
                  {SHAPE_OPTIONS.map(option => (
                    <label key={option.value} className={`tmd-choice${mShape === option.value ? ' selected' : ''}`}>
                      <input type="radio" name="tmd-material-shape" checked={mShape === option.value} onChange={() => setMShape(option.value)} />
                      <span><strong>{option.title}</strong><small>{option.desc}</small></span>
                    </label>
                  ))}
                </div>
                <label className={`tmd-choice tmd-choice-wide${mEnsemble ? ' selected' : ''}`}>
                  <input type="checkbox" checked={mEnsemble} onChange={event => setMEnsemble(event.target.checked)} />
                  <span><strong>也希望配角拥有自己的完整故事</strong><small>让重要人物有自己的追求，他们的选择会影响全书。</small></span>
                </label>
              </section>
              <section className="tmd-block">
                <h4 className="tmd-section-title">作者补充要求</h4>
                <textarea className="tmd-custom-line" aria-label="资料作者补充要求" value={mNote} maxLength={1000} rows={3} onChange={event => setMNote(event.target.value)} placeholder="写下想加入的人物关系、故事目标，或希望主编调整的方向。" />
              </section>
              <div className="tmd-footer">
                <button type="button" className="tmd-ghost" disabled={busy} onClick={cancelMaterialEdit}>取消</button>
                <button type="button" disabled={busy} onClick={saveMaterialDraftNow}>保存草稿</button>
                <button type="button" className="tmd-primary" disabled={busy || mSelected.length + mAdded.length === 0} onClick={requestMaterialSave}>保存修改</button>
              </div>
              <p className="tmd-note">「保存草稿」只暂存不影响任何后续设计；「保存修改」会形成新的正式版本，并先让你确认受影响范围。</p>
            </div>
          ) : (
            <div className="tmd-material-view">
              <div className="tmd-material-head">
                <strong>第{storylineMaterial.revision}版 · {storylineMaterial.createdBy === 'author-edit' ? '作者修改形成' : '作者确认形成'}</strong>
                <button type="button" disabled={busy} onClick={beginMaterialEdit}><PencilSimpleIcon /> 修改故事线资料</button>
              </div>
              {materialSourceRecommendation === null && <p className="tmd-note">形成本资料的推荐原文已不在当前列表；资料正文完整保留，仍可正常查看和修改。</p>}
              {storylineMaterial.draft !== null && <p className="tmd-note">有一份未保存的草稿（基于第{storylineMaterial.draft.baseRevision}版），点「修改故事线资料」可继续。</p>}
              <section className="tmd-block">
                <h4 className="tmd-section-title">已确认的故事线（{storylineMaterial.content.selectedLineIds.length + storylineMaterial.content.addedLines.length}条）</h4>
                <ul className="tmd-material-lines">
                  {/* 72c3a62f复核第1项：材料自含正文，直接可读；不依赖推荐仍在最新12轮内 */}
                  {storylineMaterial.content.selectedLines.map(line => (
                    <li key={line.id}><span className="tmd-line-role">{roleLabel(line.role)}</span><strong>{line.title}</strong><small>{line.description}</small></li>
                  ))}
                  {storylineMaterial.content.selectedLines.length === 0 && storylineMaterial.content.selectedLineIds.map(id => (
                    <li key={id}><span className="tmd-line-role">推荐线</span><strong>{id}</strong></li>
                  ))}
                  {storylineMaterial.content.addedLines.map(line => (
                    <li key={`added-${line.title}`}><span className="tmd-line-role">作者添加</span><strong>{line.title}</strong><small>{line.description}</small></li>
                  ))}
                </ul>
              </section>
              <section className="tmd-block">
                <h4 className="tmd-section-title">故事展开方式</h4>
                <p>{shapeLabelText(storylineMaterial.content.shape)}{storylineMaterial.content.ensemble ? '；也希望配角拥有自己的完整故事' : ''}</p>
              </section>
              {storylineMaterial.content.authorNote.trim() !== '' && (
                <section className="tmd-block">
                  <h4 className="tmd-section-title">作者补充要求</h4>
                  <p>{storylineMaterial.content.authorNote}</p>
                </section>
              )}
              <details className="tmd-material-summary">
                <summary>全书工作摘要（主编推荐语）</summary>
                {materialSourceRecommendation !== null ? <><p>{materialSourceRecommendation.greeting}</p><p>{materialSourceRecommendation.reason}</p></> : <p>推荐原文已不在当前列表。</p>}
              </details>
              <section className="tmd-block tmd-material-source">
                <h4 className="tmd-section-title">来源引用（只读）</h4>
                <p>推荐运行：<code>{storylineMaterial.content.recommendationRunId}</code></p>
                <p>推荐哈希：<code>{storylineMaterial.content.recommendationHash}</code></p>
                <p>设定资料版本：<code>{storylineMaterial.content.preparationVersion}</code></p>
                <p>资料版本：第{storylineMaterial.revision}版（{storylineMaterial.createdBy === 'author-edit' ? '作者修改' : '作者确认'}，{new Date(storylineMaterial.createdAt).toLocaleString('zh-CN')}）</p>
              </section>
              {storylineMaterial.versions.length > 1 && (
                <details className="tmd-material-summary">
                  <summary>历史版本（{storylineMaterial.versions.length}个，只读保留）</summary>
                  <ul>{storylineMaterial.versions.map(v => <li key={v.revision}>第{v.revision}版 · {v.createdBy === 'author-edit' ? '作者修改' : '作者确认'} · {new Date(v.createdAt).toLocaleString('zh-CN')}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      </div>
      <dialog ref={materialConfirmRef} className="tmd-dialog" aria-label="确认保存故事线资料修改">
        <h2>确认保存修改</h2>
        <p>保存此修改后，基于旧版故事线资料的全书基线，以及后续卷、链、章规划将需要重新设计。已有正文会保留，不会自动覆盖。</p>
        {materialPreview !== null && (
          <div className="tmd-material-impact">
            <p>全书基线：{materialPreview.affectedBaseline ? '已采用的基线将标记为需重新设计' : '当前没有已采用的基线'}</p>
            <p>设计方案：{materialPreview.affectedRuns.length}套将标记为需重新设计{materialPreview.affectedInFlight > 0 ? `（其中${materialPreview.affectedInFlight}套仍在进行，完成后结果保留但不可采用）` : ''}；旧结果保留可查看。</p>
            <p>卷概要：{materialPreview.downstream.volumeOutlines > 0 ? `已采用方案含${materialPreview.downstream.volumeOutlines}卷概要，重新设计后更新` : '尚未创建'}</p>
            <p>卷、链、章规划：尚未实现独立卷设计（如实标注）</p>
          </div>
        )}
        <div className="tmd-dialog-row">
          <button type="button" disabled={busy} onClick={() => materialConfirmRef.current?.close()}>取消</button>
          <button type="button" className="tmd-primary" disabled={busy} onClick={confirmMaterialSave}>保存修改并标记重设</button>
        </div>
      </dialog>

      <dialog ref={addDialogRef} className="tmd-dialog" aria-label="添加你想写的故事">
        <div className="tmd-dialog-row">
          <h2>添加你想写的故事</h2>
          <button type="button" onClick={() => addDialogRef.current?.close()}>关闭</button>
        </div>
        <form className="tmd-custom-form" onSubmit={event => { event.preventDefault(); if (!customTitle.trim() || !customDescription.trim()) return; addLineToContext({id:`custom-${crypto.randomUUID()}`,title:customTitle.trim(),description:customDescription.trim()}); setCustomTitle(''); setCustomDescription(''); addDialogRef.current?.close(); }}>
          <label>故事线名称<input value={customTitle} onChange={event => setCustomTitle(event.target.value)} maxLength={40} required placeholder="例如：重建家园" /></label>
          <label>想写怎样的故事<textarea value={customDescription} onChange={event => setCustomDescription(event.target.value)} maxLength={400} required rows={3} placeholder="谁想完成什么，会经历怎样的变化？" /></label>
          <button type="submit" className="tmd-primary" disabled={!customTitle.trim() || !customDescription.trim()}>加入故事线</button>
        </form>
        <p>也可以从全部常见故事线方向中挑选（点选即加入，可再次打开继续选）：</p>
        <div className="tmd-dialog-list" role="group" aria-label="全部故事线方向">
        {ADD_LINE_PRESETS.map(preset => (
          <button
            type="button"
            key={preset.id}
            className="tmd-dialog-option"
            disabled={lineAddTarget.some(item => item.id === preset.id)}
            onClick={() => {
              addLineToContext(preset);
              addDialogRef.current?.close();
            }}
          >
            <b>{preset.title}</b>
            <small>{preset.description}</small>
          </button>
        ))}
        </div>
      </dialog>
    </div>
  );
}

function PlanDetail({ plan, numbering }: { plan: TimeMachinePlanView; numbering: { volumes: { localId: string; code: string }[]; mainLines: string[]; branchLines: string[] } | null }) {
  const codeOf = (volumeId: string, index: number) => numbering?.volumes.find(item => item.localId === volumeId)?.code ?? volumeLetter(index);
  const lineLabel = (lineId: string, index: number) => {
    const line = plan.lines.find(item => item.id === lineId);
    if (line === undefined) return lineId;
    const mainIndex = plan.lines.filter(l => l.role === 'main').indexOf(line);
    const branchIndex = plan.lines.filter(l => l.role !== 'main').indexOf(line);
    return line.role === 'main' ? (numbering?.mainLines[mainIndex] ?? `主线${mainIndex + 1}`) : (numbering?.branchLines[branchIndex] ?? `支线${branchIndex + 1}`);
  };
  return (
    <div className="tmd-plan">
      <div className="tmd-baseline">
        <p><strong>全书基线</strong>{plan.baseline}</p>
        <p><strong>最终回答</strong>{plan.ending}</p>
        <p><strong>计划字数</strong>{formatWords(plan.words.target)}{plan.words.hard ? '（作者硬要求）' : '（软目标，超出会重新估量）'}</p>
      </div>
      {plan.openingHooks.length === 3 && (
        <div className="tmd-opening">
          <h4>开篇，就让读者想看下去</h4>
          <div className="tmd-opening-grid">
            <article className="tmd-opening-card"><span>开头约300字</span><b>{plan.openingHooks[0]}</b></article>
            <article className="tmd-opening-card"><span>第一章</span><b>{plan.openingHooks[1]}</b></article>
            <article className="tmd-opening-card"><span>前三章</span><b>{plan.openingHooks[2]}</b></article>
          </div>
        </div>
      )}
      {plan.expectations.length > 0 && (
        <div className="tmd-expectations">
          <h4>从开篇惦记到结尾</h4>
          <div className="tmd-expect-head"><span>开篇的期待</span><span>想看到的变化</span><span>结尾的回应</span></div>
          {plan.expectations.map(expectation => (
            <div key={expectation.id} className="tmd-expect-row"><p>{expectation.opening}</p><p>{expectation.change}</p><p>{expectation.answer}</p></div>
          ))}
        </div>
      )}
      <div className="tmd-lines">
        <h4>故事线怎样交织</h4>
        {plan.lines.map((line, index) => (
          <div key={line.id} className="tmd-line-item">
            <span className="tmd-line-role">{lineLabel(line.id, index)}</span>
            <strong>{line.title}</strong>
            <small>{line.process}</small>
            {line.milestones.length > 0 && (
              <div className="tmd-chain">
                {line.milestones.map(milestone => (
                  <span key={milestone.id} className="tmd-chain-node">{milestone.summary}<small>{milestone.suggestedVolumes.map(id => {
                    const volumeIndex = plan.volumes.findIndex(v => v.id === id);
                    return volumeIndex >= 0 ? `卷${codeOf(id, volumeIndex)}` : id;
                  }).join('—')}{milestone.importance === 'required' ? '·必选' : ''}</small></span>
                ))}
                <span className="tmd-chain-node tmd-chain-end">{line.answer}<small>收束</small></span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="tmd-volumes">
        {plan.relations.length > 0 && <section className="tmd-panel"><h4>关键交织</h4>{plan.relations.map((relation,index)=><p key={index}><strong>{lineLabel(relation.from,0)} → {lineLabel(relation.to,0)}</strong>　{relation.effect}</p>)}</section>}
        {plan.volumes.map((volume, index) => (
          <VolumeCard key={volume.id} volume={volume} code={codeOf(volume.id, index)} plan={plan} lineLabel={lineLabel} />
        ))}
      </div>
    </div>
  );
}

function VolumeCard({ volume, code, plan, lineLabel }: { volume: TimeMachineVolumeView; code: string; plan: TimeMachinePlanView; lineLabel: (lineId: string, index: number) => string }) {
  const entry = plan.anchors.find(anchor => anchor.ownerEntityId === volume.id && anchor.kind === 'entry');
  const exit = plan.anchors.find(anchor => anchor.ownerEntityId === volume.id && anchor.kind === 'exit');
  return (
    <details className="tmd-volume-card" open={false}>
      <summary>
        <span className="tmd-volume-code">卷{code}</span>
        <strong>{volume.title}</strong>
        {volume.beat.trim() !== '' && <span className="tmd-volume-beat">{volume.beat}</span>}
        <small>{formatWords(volume.words.target)}</small>
      </summary>
      <div className="tmd-volume-body">
        <p><strong>开场</strong>{entry?.summary ?? volume.start}</p>
        <p><strong>本卷目标</strong>{volume.goal}</p>
        <p><strong>主要阻碍</strong>{volume.conflict}</p>
        <p><strong>关键转折</strong>{volume.turningPoint}</p>
        {volume.arc !== null && <p><strong>人物变化</strong>{volume.arc}</p>}
        {volume.payoff !== null && <p><strong>期待兑现</strong>{volume.payoff}</p>}
        {volume.hook !== null && <p><strong>爽点</strong>{volume.hook}</p>}
        {volume.mood !== null && <p><strong>情绪</strong>{volume.mood}</p>}
        {volume.gain !== null && <p><strong>获得</strong>{volume.gain}</p>}
        {volume.loss !== null && <p><strong>失去</strong>{volume.loss}</p>}
        <p><strong>收束</strong>{exit?.summary ?? volume.ending}</p>
        {volume.handoff.trim() !== '' && <p><strong>留给下一卷</strong>{volume.handoff}</p>}
        <div className="tmd-duties">
          {volume.duties.map(duty => (
            <p key={duty.lineId}><span className={`tmd-duty-strength${duty.strength === 'required' ? ' required' : ''}`}>{duty.strength === 'required' ? '必做' : '可调'}</span>{lineLabel(duty.lineId, plan.lines.findIndex(l => l.id === duty.lineId))}·{actionLabel(duty.action)}：{duty.result}</p>
          ))}
        </div>
        {entry !== undefined && exit !== undefined && (
          <details className="tmd-anchor-detail">
            <summary>开场/收束核对条件</summary>
            <p><strong>开场条件</strong>{entry.conditions.map(condition => condition.summary).join('；')}（{entry.importance === 'required' ? '必达' : '可调'}；未达成：{entry.fallback}）</p>
            <p><strong>收束条件</strong>{exit.conditions.map(condition => condition.summary).join('；')}（{exit.importance === 'required' ? '必达' : '可调'}；未达成：{exit.fallback}）</p>
          </details>
        )}
      </div>
    </details>
  );
}

function PlanEditor({ plan, onChange }: { plan: TimeMachinePlanView; onChange: (plan: TimeMachinePlanView) => void }) {
  const update = (patch: Partial<TimeMachinePlanView>) => onChange({ ...plan, ...patch });
  const updateVolume = (index: number, patch: Partial<TimeMachineVolumeView>) => {
    const volumes = plan.volumes.map((volume, i) => i === index ? { ...volume, ...patch } : volume);
    const volume = plan.volumes[index];
    const anchors = patch.ending === undefined ? plan.anchors : plan.anchors.map(anchor => anchor.ownerEntityId === volume?.id && anchor.kind === 'exit'
      ? { ...anchor, summary: patch.ending! }
      : anchor);
    update({ volumes, anchors });
  };
  return (
    <div className="tmd-editor">
      <p className="tmd-note">修改会保存为新版本，原方案保留可回看；分卷字数与锚点结构由系统校验。</p>
      <label><span>全书基线</span><textarea rows={3} value={plan.baseline} onChange={event => update({ baseline: event.target.value })} /></label>
      <label><span>最终回答</span><textarea rows={2} value={plan.ending} onChange={event => update({ ending: event.target.value })} /></label>
      {plan.volumes.map((volume, index) => (
        <fieldset key={volume.id}>
          <legend>卷{volumeLetter(index)} · {volume.title}</legend>
          <label><span>卷名</span><input value={volume.title} onChange={event => updateVolume(index, { title: event.target.value })} /></label>
          <label><span>本卷目标</span><textarea rows={2} value={volume.goal} onChange={event => updateVolume(index, { goal: event.target.value })} /></label>
          <label><span>收束</span><textarea rows={2} value={volume.ending} onChange={event => updateVolume(index, { ending: event.target.value })} /></label>
          {plan.anchors.filter(anchor=>anchor.ownerEntityId===volume.id&&anchor.kind==='exit').map(anchor=><div key={anchor.id}>
            <p>收束核对条件（修改后由主编检查是否一致）</p>
            {anchor.conditions.map((condition,conditionIndex)=><label key={conditionIndex}><span>条件{conditionIndex+1}</span><textarea rows={2} value={condition.summary} onChange={event=>update({anchors:plan.anchors.map(item=>item.id===anchor.id?{...item,conditions:item.conditions.map((entry,i)=>i===conditionIndex?{...entry,summary:event.target.value}:entry)}:item)})}/></label>)}
          </div>)}
        </fieldset>
      ))}
    </div>
  );
}
