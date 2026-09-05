import {
  BookOpenTextIcon,
  CheckCircleIcon,
  FileTextIcon,
  FlowArrowIcon,
  LeafIcon,
  LightbulbIcon,
  NotePencilIcon,
  PenNibIcon,
  ShieldCheckIcon,
  TreeStructureIcon,
  UsersThreeIcon
} from '@phosphor-icons/react';
import type { AuthorAccount } from './account-api';

type PublicIcon = typeof LightbulbIcon;

const HERO_STEPS: Array<[string, PublicIcon]> = [
  ['想法', LightbulbIcon],
  ['角色', UsersThreeIcon],
  ['世界', TreeStructureIcon],
  ['大纲', FlowArrowIcon],
  ['章节', BookOpenTextIcon],
  ['正文', FileTextIcon]
];

const PROCESS_STEPS = [
  ['01', '想法', '记录灵感与主题，确定故事方向。'],
  ['02', '角色世界', '设定人物关系、世界规则和开局处境。'],
  ['03', '故事框架', '梳理主线、支线、阶段目标和冲突。'],
  ['04', '大纲章节', '拆解章节要点，安排转折与信息释放。'],
  ['05', '正文', '进入章节写作、审查和采纳。']
] as const;

const EDITORIAL_ROLES: Array<[string, string, PublicIcon]> = [
  ['主编', '把控整体方向与一致性。', LeafIcon],
  ['剧情编剧', '梳理主线、支线与阶段冲突。', FlowArrowIcon],
  ['世界观编辑', '维护规则、势力与背景资料。', TreeStructureIcon],
  ['写作编辑', '推进章节正文与表达。', PenNibIcon]
];

type PublicHomepageAccountState =
  | { status: 'checking' }
  | { status: 'guest' }
  | { status: 'authenticated'; account: AuthorAccount };

export function PublicHomepage({
  accountState,
  onLogin,
  onRegister,
  onStart,
  onOpenWorkspace
}: {
  accountState: PublicHomepageAccountState;
  onLogin: () => void;
  onRegister: () => void;
  onStart: () => void;
  onOpenWorkspace: () => void;
}): React.JSX.Element {
  const authenticated = accountState.status === 'authenticated';
  return <main className="public-homepage">
    <header className="public-home-header" aria-label="文秘写作官网导航">
      <button
        className="public-brand-lockup"
        type="button"
        onClick={(event) => event.currentTarget.closest('.public-homepage')?.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="回到文秘写作首页"
      >
        <span className="brand-mark" aria-hidden="true">文</span>
        <span>文秘写作</span>
      </button>
      <nav className="public-home-nav" aria-label="公开入口">
        {authenticated
          ? <>
            <span className="public-account-chip">{accountState.account.displayName}</span>
            <button className="public-nav-primary" type="button" onClick={onOpenWorkspace}>进入工作台</button>
          </>
          : <>
            <button className="public-nav-link" type="button" onClick={onLogin}>登录</button>
            <button className="public-nav-primary" type="button" onClick={onRegister}>注册</button>
          </>}
      </nav>
    </header>

    <section className="public-hero" aria-labelledby="public-home-title">
      <div className="public-hero-copy">
        <h1 id="public-home-title" aria-label="从一个想法，开始你的小说。">
          <span aria-hidden="true">从一个想法，</span>
          <span aria-hidden="true">开始你的小说。</span>
        </h1>
        <p>不必先掌握复杂的写作技巧。文秘写作通过多智能体协作，辅助你设计角色、世界背景和故事框架，逐步完成大纲、章节规划与正文。</p>
        <strong>AI 帮你展开故事，每一步都由你决定。</strong>
        <div className="public-hero-actions">
          <button className="public-primary-action" type="button" onClick={authenticated ? onOpenWorkspace : onStart}>
            <PenNibIcon />
            <span>{authenticated ? '进入工作台' : '开始创作'}</span>
          </button>
        </div>
      </div>

      <div className="public-workflow-preview" aria-label="创作流程示意">
        <header>
          <span className="brand-mark" aria-hidden="true">文</span>
          <div>
            <strong>创作流程示意</strong>
            <small>从灵感到正文的协作路径</small>
          </div>
        </header>
        <div className="public-preview-grid">
          {HERO_STEPS.map(([label, Icon], index) => <article key={label}>
            <span><Icon aria-hidden="true" /></span>
            <strong>{label}</strong>
            {index < 5 && <i aria-hidden="true" />}
          </article>)}
        </div>
        <section className="public-manuscript-preview" aria-label="正文示意">
          <small>第 1 章</small>
          <p />
          <p />
          <p />
          <p />
        </section>
      </div>
    </section>

    <section className="public-process-section" aria-labelledby="public-process-title">
      <div className="public-section-heading">
        <h2 id="public-process-title">从想法到正文，逐步成形</h2>
        <p>先把灵感整理成可写的故事骨架，再进入章节和正文；每一步都能查看、修改、重做或继续。</p>
      </div>
      <div className="public-process-rail" aria-label="小说创作步骤">
        {PROCESS_STEPS.map(([step, title, copy]) => <article key={step}>
          <span>{step}</span>
          <strong>{title}</strong>
          <p>{copy}</p>
          <small><NotePencilIcon aria-hidden="true" /> 查看 / 修改</small>
        </article>)}
      </div>
      <div className="public-control-panel">
        <div>
          <h3>每一步都可审阅与调整</h3>
          <p>你可以随时查看方案、调整方向，选择采纳的结果。已采纳内容会作为后续创作参考，未采纳的候选不会混入正式设定。</p>
        </div>
        <ul>
          <li><CheckCircleIcon /> 查看完整内容</li>
          <li><NotePencilIcon /> 调整细节与方向</li>
          <li><FlowArrowIcon /> 重做或继续下一步</li>
        </ul>
      </div>
    </section>

    <section className="public-memory-section" id="collaboration" aria-labelledby="public-memory-title">
      <div className="public-section-heading">
        <h2 id="public-memory-title">编辑部协作，记住你的长期创作线索</h2>
        <p>主编、剧情、世界与写作分工协作，把你采纳过的角色、规则、伏笔和章节正文沉淀为后续参考。</p>
      </div>
      <div className="public-memory-layout">
        <div className="public-editorial-map" aria-label="多智能体协作示意">
          {EDITORIAL_ROLES.map(([title, copy, Icon]) => <article key={title}>
            <Icon aria-hidden="true" />
            <span><strong>{title}</strong><small>{copy}</small></span>
          </article>)}
        </div>
        <div className="public-memory-ledger">
          <strong>长期创作记忆</strong>
          <p>保存已确认的设定与剧情线索，供后续创作查阅；你可以核对与调整，让长篇故事持续沿着自己的方向生长。</p>
          <div>
            {['角色与关系', '世界规则', '伏笔与开放问题', '章节正文'].map((item) => <span key={item}>{item}</span>)}
          </div>
          <small><ShieldCheckIcon aria-hidden="true" /> 已采纳内容和作者原文会作为后续创作依据保留。</small>
        </div>
      </div>
    </section>

    <footer className="public-home-footer" id="contact">
      <div>
        <span className="brand-mark" aria-hidden="true">文</span>
        <strong>文秘写作</strong>
        <p>让创作更有章法。</p>
      </div>
      <nav aria-label="帮助与联系">
        <a href="#collaboration">了解协作方式</a>
        <a href="#contact">联系</a>
        <a href="#script-plan">短剧创作</a>
      </nav>
      <section id="script-plan" aria-label="联系与短剧创作说明">
        <p>会员办理与问题反馈：管理员微信 595341366。</p>
        <p>短剧创作：规划中。</p>
      </section>
    </footer>
  </main>;
}
