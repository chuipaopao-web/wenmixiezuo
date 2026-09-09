import { BOOK_CARD_FIELDS, BOOK_CARD_TARGET_CHARS, BOOK_CARD_MAX_CHARS, BOOK_CARD_PAGE_CHARS,
  BOOK_CARD_TEMPLATE_VERSION, BOOK_CARD_INSTRUCTIONS } from '../../backend/planning-methods/book-design-card';
export function BookCardTemplatePage(): React.JSX.Element {
  return <section className="rhythm-page"><header><h2>全书信息短卡</h2><p>资料成员按六栏整理已有开书资料和设定，全书方向直接使用。模板 {BOOK_CARD_TEMPLATE_VERSION}</p></header>
    <div className="rhythm-panel">{BOOK_CARD_FIELDS.map(f=><article key={f.key}><h3>{f.label}</h3><p>{f.instruction}</p></article>)}</div>
    <section className="rhythm-panel"><h3>整理与使用</h3><p>{BOOK_CARD_INSTRUCTIONS}</p><p>在全书方向准备阶段整理；先分批填写，再两两合并，最后逐页核对原文中的关键条件。同一本书来源版本不变就复用，来源改变生成新卡。失败保留已完成批次。卷、链、章不直接复制整张全书卡。</p>
      <p>每批资料不超过{BOOK_CARD_PAGE_CHARS}字符，短卡目标约{BOOK_CARD_TARGET_CHARS}字符、正文上限{BOOK_CARD_MAX_CHARS}字符。不机械截断；超过预算重新精简，仍不合格就保留进度并报告失败。</p>
      <p>当前模板随代码发布，页面只读。这里展示规则，不展示其他作者的作品内容。结构和预算检查不等于保证模型没有遗漏。</p></section>
  </section>;
}
