# Chat Attachments and Purge UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作台移除重复顶部信息、以左右对话气泡充分利用中间区域、支持可解析的图片/文件附件，并为归档书提供严格确认的永久删除入口。

**Architecture:** React工作台只保存待发送附件状态；Fastify以受限multipart接口接收文件，附件服务保存原文件、提取文本并生成有界上下文摘录。SQLite是附件元数据权威源，附件始终属于当前书的临时对话层；消息只引用附件ID和有界摘录，不能自动晋升正史。永久删除继续复用现有 `YES <书名> <短ID>` 后端契约，前端不降低确认强度。

**Tech Stack:** React 19、TypeScript、Vite、Fastify 5、`@fastify/multipart`、SQLite、`pdfjs-dist`、`mammoth`、Vitest、Testing Library。

## Global Constraints

- 只修改 `D:\wenmixiezuo`，不得修改、停止或重启 `D:\AI智囊团`。
- 服务继续只监听 `127.0.0.1`；API Key只读环境变量。
- 附件每个不超过20 MiB，每条消息最多6个；文本解析最多保留2,000,000字符，模型上下文所有附件合计最多12,000字符。
- 图片只提供安全预览与附件身份；没有视觉模型证据时不得声称已识别图片内容。
- 附件默认是当前书、当前对话的临时资料，不写入正史、Wiki、向量正史投影或正式正文。
- 永久删除只允许归档书，必须逐字输入 `YES <书名> <短ID>`；测试只能删除临时测试书。
- 数据库迁移只新增 `0019_chat_attachments.sql`，不得修改已合并迁移。

---

### Task 1: 冻结附件生命周期与数据库契约

**Files:**
- Create: `apps/api/src/infrastructure/db/migrations/0019_chat_attachments.sql`
- Create: `apps/api/src/infrastructure/db/repositories/chat-attachment-repository.ts`
- Test: `tests/integration/experience/chat-attachments-api.test.ts`

**Interfaces:**
- Consumes: `BookScope`、SQLite `messages`/`books`/`operations`/`file_registry` 表和现有迁移执行器。
- Produces: `ChatAttachmentRepository.create/get/listForMessage/bindToMessage/discard`，所有读取都强制 `owner_id + book_id`。

- [ ] **Step 1: 写失败测试**

```ts
expect(uploaded).toMatchObject({ lifecycleLayer: 'temporary', parseStatus: 'parsed' });
expect(() => otherBookRepository.get(uploaded.attachmentId)).toThrow('附件不存在或不属于当前书籍');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/integration/experience/chat-attachments-api.test.ts`
Expected: FAIL，原因是迁移、Repository或接口尚不存在。

- [ ] **Step 3: 新增向前迁移与Repository**

```sql
CREATE TABLE chat_attachments (
  attachment_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  message_id TEXT,
  original_name TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image','text','pdf','docx')),
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 20971520),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_relative_path TEXT NOT NULL UNIQUE,
  extracted_relative_path TEXT,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed','truncated','preview_only','no_text','failed','discarded')),
  parsed_char_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_char_count >= 0),
  context_excerpt TEXT NOT NULL DEFAULT '',
  parse_error TEXT,
  lifecycle_layer TEXT NOT NULL DEFAULT 'temporary' CHECK (lifecycle_layer = 'temporary'),
  created_at TEXT NOT NULL,
  attached_at TEXT,
  FOREIGN KEY (owner_id, book_id) REFERENCES books(owner_id, book_id),
  FOREIGN KEY (message_id) REFERENCES messages(message_id)
) STRICT;
```

- [ ] **Step 4: 运行Repository与迁移测试**

Run: `npx vitest run tests/foundation/migration.test.ts tests/integration/experience/chat-attachments-api.test.ts`
Expected: PASS，空库到19号迁移成功，跨书读取失败。

### Task 2: 实现受限上传与真实文件解析

**Files:**
- Create: `apps/api/src/application/chat/chat-attachment-service.ts`
- Modify: `apps/api/src/http/server.ts`
- Modify: `apps/api/src/http/domain-routes.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Test: `tests/integration/experience/chat-attachments-api.test.ts`

**Interfaces:**
- Consumes: multipart单文件流、`RuntimeConfig.dataDir`、`ChatAttachmentRepository`。
- Produces: `POST /api/v1/books/:bookId/chat-attachments`、`GET .../:attachmentId/content`、`POST .../:attachmentId/discard`。

- [ ] **Step 1: 写上传、解析、限制和跨书测试**

```ts
expect(textUpload.json().data).toMatchObject({ mediaKind: 'text', parseStatus: 'parsed' });
expect(textUpload.json().data.contextExcerpt).toContain('张三');
expect(oversize.statusCode).toBe(413);
expect(crossBookRead.statusCode).toBe(500);
```

- [ ] **Step 2: 安装锁定依赖**

Run: `npm install -w @wenmi/api @fastify/multipart@10.1.0 mammoth@1.12.0 pdfjs-dist@6.1.200`
Expected: `package-lock.json` 更新且npm退出码为0。

- [ ] **Step 3: 实现白名单解析器与安全存储**

```ts
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_STORED_TEXT_CHARS = 2_000_000;
const MAX_CONTEXT_EXCERPT_CHARS = 12_000;
// text使用UTF-8；docx使用mammoth.extractRawText；PDF逐页getTextContent；图片为preview_only。
```

原文件写入 `data/books/<bookId>/attachments/<attachmentId>/source.<safeExt>`，提取文本写入同目录 `extracted.txt`；路径不使用原始文件名。解析失败保留明确状态和错误摘要，不伪造成功。

- [ ] **Step 4: 运行接口测试**

Run: `npx vitest run tests/integration/experience/chat-attachments-api.test.ts`
Expected: PASS，文本可解析、图片可预览、错误透明、大小与书籍隔离生效。

### Task 3: 把附件绑定到消息并限制上下文注入

**Files:**
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- Modify: `apps/api/src/http/domain-routes.ts`
- Test: `tests/integration/experience/chat-attachments-api.test.ts`
- Test: `tests/integration/experience/workspace-api.test.ts`

**Interfaces:**
- Consumes: `attachmentIds: string[]`，每个附件必须是同书、未丢弃且未绑定其他消息。
- Produces: `sendBossMessageWithLocalAssistant(scope, content, attachmentIds)`；消息 `references_json` 保存附件证据；模型只收到合计不超过12,000字符的附件资料段。

- [ ] **Step 1: 写消息绑定失败测试**

```ts
expect(crossBookSend.statusCode).toBe(500);
expect(JSON.parse(saved.references_json)[0]).toMatchObject({ type: 'chat_attachment' });
expect(context.database.prepare('SELECT canon_revision FROM books WHERE book_id = ?').get(bookId)).toEqual({ canon_revision: 0 });
```

- [ ] **Step 2: 实现原子绑定和有界上下文**

```ts
const attachmentContext = attachments
  .map(item => `[附件：${item.originalName}｜${item.parseStatus}]\n${item.contextExcerpt}`)
  .join('\n\n')
  .slice(0, 12_000);
```

消息显示内容保持老板原话；附件上下文只供当前路由出的创作讨论/成员回复使用。附件不调用正史晋升、知识生命周期或向量投影接口。

- [ ] **Step 3: 运行消息与正史隔离测试**

Run: `npx vitest run tests/integration/experience/chat-attachments-api.test.ts tests/integration/experience/workspace-api.test.ts`
Expected: PASS，跨书为零、附件可回链、正史修订不变化、上下文不超预算。

### Task 4: 重做聊天布局和附件交互

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `apps/web/src/lib/api/client.ts`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: `ChatAttachmentData`、上传/丢弃API和消息 `attachmentIds`。
- Produces: 左侧成员头像＋气泡、右侧老板头像＋气泡、全宽消息区、附件加号、上传状态、图片缩略图和文件解析状态。

- [ ] **Step 1: 修改UI测试为新验收**

```ts
expect(screen.queryByText('聊天只按需带入最近上下文，不会自动写入正史。Ctrl + Enter 发送。')).not.toBeInTheDocument();
expect(screen.getByRole('button', { name: '添加图片或文件' })).toBeInTheDocument();
expect(document.querySelector('.message.boss')).toHaveClass('align-right');
expect(document.querySelector('.message.agent')).toHaveClass('align-left');
```

- [ ] **Step 2: 移除顶部重复信息**

删除 `WORKSPACE_VIEW_LABELS`、`.topbar-center` 和 `WorkspaceBookSummary` 渲染；所有工作区视图高度改为 `100%`，错误条位置移到主区顶部浮层。

- [ ] **Step 3: 实现附件加号和状态条**

```tsx
<input hidden multiple type="file" accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.json,.csv,.log,.pdf,.docx" />
<button type="button" aria-label="添加图片或文件"><PlusIcon /></button>
```

选择文件后立即显示上传中状态；成功后显示图片预览或文件名、解析状态和字符数；失败显示原因并不冒充可用。发送成功清空附件，切书时不跨书保留附件。

- [ ] **Step 4: 实现左右聊天气泡**

老板消息使用右侧头像与气泡，Agent使用岗位原型头像和左侧气泡；系统通知保留中性左侧样式。消息最大宽度使用主区的78%，不再固定720px居中。

- [ ] **Step 5: 运行UI与无障碍测试**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx`
Expected: PASS，顶部重复区不存在、左右布局和附件控件存在、axe无新增违规。

### Task 5: 为归档书提供严格永久删除入口

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/api/src/application/books/book-lifecycle-service.ts`
- Test: `tests/integration/experience/workspace-ui.test.tsx`
- Test: `tests/integration/data-safety/book-lifecycle.test.ts`

**Interfaces:**
- Consumes: 已归档 `BookData` 和后端现有确认词 `YES <title> <shortId>`。
- Produces: `purgeBook(bookId, confirmationText)` 与 `PurgeBookDialog`；后端拒绝对非归档书永久删除。

- [ ] **Step 1: 写严格确认测试**

```ts
expect(screen.getByRole('button', { name: '彻底删除' })).toBeDisabled();
fireEvent.change(input, { target: { value: 'YES 雾钟档案 bookui1' } });
expect(screen.getByRole('button', { name: '彻底删除' })).toBeEnabled();
```

- [ ] **Step 2: 加固后端状态门禁**

```ts
if (book.status !== 'archived') throw new Error('只有已归档书籍可以永久删除');
```

- [ ] **Step 3: 实现危险操作对话框**

对话框明确列出书名、不可恢复影响和逐字确认词；按钮在完全匹配前禁用。成功后重新加载书架，不自动选择或删除其他书。

- [ ] **Step 4: 运行删除测试**

Run: `npx vitest run tests/integration/data-safety/book-lifecycle.test.ts tests/integration/experience/workspace-ui.test.tsx`
Expected: PASS，活动书不能永久删除，错误确认词不能调用接口，正确确认词只删除目标测试书。

### Task 6: 文档、完整验证与交付证据

**Files:**
- Create: `docs/CHAT_ATTACHMENTS_UI_AUDIT.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/API.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/MEMORY.md`
- Modify: `TASKS.md`
- Modify: `docs/release/wm-longform-r1-20260719-003435-e4d7b8b7/PHASE-08-ACCEPTANCE.md`

**Interfaces:**
- Consumes: 全部实现与测试结果。
- Produces: DEC-034、`DR-20260719-12`、阶段验收证据和可回滚Git提交。

- [ ] **Step 1: 运行审计格式验证**

Run: `node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/CHAT_ATTACHMENTS_UI_AUDIT.md`
Expected: PASS。

- [ ] **Step 2: 运行质量门禁**

Run: `npm run typecheck && npm run test && npm run build`
Expected: 全部退出码0。

- [ ] **Step 3: 运行迁移、启动和恢复验证**

Run: `npm run migrate && npm run verify:backup`
Expected: Schema 19，升级/空库/备份恢复验证全部通过。

- [ ] **Step 4: 检查秘密、占位和范围**

Run: `git diff --check && rg -n "TODO|FIXME|AIza|sk-[A-Za-z0-9]" apps docs tests`
Expected: 无新占位、无密钥、无空白错误。

- [ ] **Step 5: 提交并推送**

```powershell
git add apps tests docs TASKS.md package-lock.json
git commit -m "feat: add parsed chat attachments and strict book purge"
git push origin main
```

Expected: 私有远程 `origin/main` 更新成功。
