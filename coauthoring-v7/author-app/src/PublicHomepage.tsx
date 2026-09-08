import {
  CheckCircleIcon,
  FlowArrowIcon,
  NotePencilIcon,
  PenNibIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import type { AuthorAccount } from './account-api';
import { memberAvatarStyle, memberDisplayName } from './member-avatars';

const PROCESS_STEPS = [
  ['01', '想法', '记录灵感与主题，确定故事方向。'],
  ['02', '角色世界', '设定人物关系、世界规则和开局处境。'],
  ['03', '故事框架', '梳理主线、支线、阶段目标和冲突。'],
  ['04', '大纲章节', '拆解章节要点，安排转折与信息释放。'],
  ['05', '正文', '进入章节写作、审查和采纳。']
] as const;

const EDITORIAL_MEMBERS = [
  {
    memberKey: 'chief-deepseek-v4-pro',
    name: '貂蝉',
    role: 'AI主编',
    responsibility: '统筹开书、路线和审查，给出可执行结论。'
  },
  {
    memberKey: 'deputy-glm-5-3',
    name: '西施',
    role: 'AI副编',
    responsibility: '整理当前需要的资料，标注依据和不确定处。'
  },
  {
    memberKey: 'planner-deepseek-v4-pro',
    name: '红玉',
    role: 'AI策划编剧',
    responsibility: '设计开书、设定和故事框架，保持方案可修改。'
  },
  {
    memberKey: 'writer-kimi-k3',
    name: '清照',
    role: 'AI主笔',
    responsibility: '依据确认章纲和正式资料创作完整正文。'
  },
  {
    memberKey: 'review-kimi-k3',
    name: '周行简',
    role: 'AI审查编辑',
    responsibility: '独立检查正文事实、连续性、人物和节奏。'
  }
] as const;

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
        <img className="public-brand-image" src="/branding/wenmi-logo-r174.png" alt="" />
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
        <h1 id="public-home-title" aria-label="无需经验，无需文笔。">
          <span aria-hidden="true">无需经验，</span>
          <span aria-hidden="true">无需文笔。</span>
        </h1>
        <p>多智能体协同创作，人人都可以创作出高质量网文作品。</p>
        <p className="public-deliverables">框架、大纲、细纲、章纲、正文、角色人设、故事线，一站式原创设计。</p>
        <strong>你决定故事方向，AI 编辑部帮你展开。</strong>
        <div className="public-hero-actions">
          <button className="public-primary-action" type="button" onClick={authenticated ? onOpenWorkspace : onStart}>
            <PenNibIcon />
            <span>{authenticated ? '进入工作台' : '开始创作'}</span>
          </button>
        </div>
        <a className="public-hero-editors" href="#collaboration" aria-label="查看 AI 编辑部协同创作">
          <span className="public-hero-avatar-stack" aria-hidden="true">
            {EDITORIAL_MEMBERS.map((member) => <i key={member.memberKey} style={memberAvatarStyle(member.memberKey)} />)}
          </span>
          <span>
            <strong>AI编辑部协同创作</strong>
            <small>主编、副编、策划、主笔和审查编辑接力推进。</small>
          </span>
        </a>
      </div>

      <section className="public-hero-team" id="collaboration" aria-labelledby="public-team-title">
        <header><small>你的 AI 编辑部</small><h2 id="public-team-title">一个想法，我们一起写。</h2></header>
        <div className="public-editorial-map" aria-label="AI编辑部代表成员">
          {EDITORIAL_MEMBERS.map((member) => <article key={member.memberKey}>
            <span className="public-editorial-avatar" style={memberAvatarStyle(member.memberKey)} aria-hidden="true" />
            <span><small>{member.role}</small><strong>{memberDisplayName(member.memberKey, member.name)}</strong><p>{member.responsibility}</p></span>
          </article>)}
        </div>
      </section>
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

    <section className="public-memory-section" aria-labelledby="public-memory-title">
      <div className="public-section-heading">
        <h2 id="public-memory-title">让长篇创作，有迹可循。</h2>
      </div>
      <div>
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
        <img className="public-brand-image" src="/branding/wenmi-logo-r174.png" alt="" />
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
