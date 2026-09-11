/** 后台规格文档只读渲染：与仓库 Markdown 同源，搜索/章节导航，不另建状态副本。 */

export interface SpecSection { title: string; body: string }

export function splitSpecDocument(text: string): SpecSection[] {
  return text.split(/^## /m).slice(1).map(part => { const end = part.indexOf('\n'); return { title: part.slice(0, end).trim(), body: part.slice(end + 1).trim() }; });
}

export function SpecDocumentBody({ text }: { text: string }): React.JSX.Element {
  const lines = text.split(/\r?\n/); const blocks: React.JSX.Element[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!.trim(); if (!line) { i++; continue; }
    if (line.startsWith('|')) {
      const rows: string[][] = []; while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i++]!.trim().slice(1, -1).split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      blocks.push(<div className="workflow-table" key={i}><table><thead><tr>{rows[0]?.map((c, k) => <th key={k} scope="col">{c}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, k) => <tr key={k}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = []; while (i < lines.length && /^\d+\. /.test(lines[i]!.trim())) items.push(lines[i++]!.trim().replace(/^\d+\. /, ''));
      blocks.push(<ol key={i}>{items.map((item, k) => <li key={k}>{item}</li>)}</ol>); continue;
    }
    if (line.startsWith('### ')) { blocks.push(<h4 key={i}>{line.slice(4)}</h4>); i++; continue; }
    if (line.startsWith('- ')) {
      const items: string[] = []; while (i < lines.length && lines[i]!.trim().startsWith('- ')) items.push(lines[i++]!.trim().slice(2));
      blocks.push(<ul key={i}>{items.map((item, k) => <li key={k}>{item}</li>)}</ul>); continue;
    }
    const paragraph = [line]; i++; while (i < lines.length && lines[i]!.trim() && !lines[i]!.trim().startsWith('|') && !lines[i]!.trim().startsWith('### ') && !lines[i]!.trim().startsWith('- ') && !/^\d+\. /.test(lines[i]!.trim())) paragraph.push(lines[i++]!.trim());
    blocks.push(<p key={i}>{paragraph.join(' ')}</p>);
  }
  return <>{blocks}</>;
}
