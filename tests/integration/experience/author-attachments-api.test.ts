import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('作者资料附件API', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('解析文本、绑定当前设定想法且不改变正史', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '附件讨论书', text: '验证附件只属于当前作者想法'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });

    const upload = await uploadFile(app, book.bookId, 'setting.txt', 'text/plain', Buffer.from('张三今天准备对天安城宣战。\n战争规则要求先递交战书。'));
    expect(upload.statusCode).toBe(200);
    const attachment = upload.json().data as Record<string, unknown>;
    expect(attachment).toMatchObject({
      originalName: 'setting.txt', mediaKind: 'text', parseStatus: 'parsed', lifecycleLayer: 'temporary'
    });
    const attachmentId = attachment.attachmentId as string;
    const stored = context.database.prepare(`SELECT context_excerpt, origin_record_id, lifecycle_layer
      FROM author_attachments WHERE attachment_id = ?`).get(attachmentId) as Record<string, unknown>;
    expect(stored).toMatchObject({ origin_record_id: null, lifecycle_layer: 'temporary' });
    expect(stored.context_excerpt).toContain('天安城');

    const authorInput = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/author-planning-inputs`,
      payload: {
        surface: 'setting', subjectType: 'setting_module', subjectId: 'conflict-rule',
        intentStrength: 'preference', originalText: '请参考附件判断宣战规则是否合理。',
        attachmentRefs: [attachmentId], mentionedAgentIds: [], scopeNotes: '只供当前设定对象参考',
        idempotencyKey: 'attachment-setting-reference'
      }
    });
    expect(authorInput.statusCode).toBe(200);
    expect(authorInput.json().data).toMatchObject({ attachmentRefs: [attachmentId], status: 'new' });
    expect(context.database.prepare(`SELECT target_type, target_id FROM author_planning_input_links
      WHERE owner_id = ? AND book_id = ? AND author_input_id = ?`)
      .get(context.config.ownerId, book.bookId, authorInput.json().data.authorInputId))
      .toEqual({ target_type: 'author_attachment', target_id: attachmentId });
    expect(context.database.prepare('SELECT canon_revision FROM books WHERE book_id = ?').get(book.bookId))
      .toEqual({ canon_revision: 0 });
  });

  it('支持DOCX、文字PDF和图片预览，并透明报告扫描件无文字', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '多格式附件书', text: '验证本地解析格式'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });

    const docx = await makeDocx('DOCX中的人物设定：沈青害怕钟声。');
    const docxResponse = await uploadFile(
      app, book.bookId, 'character.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx
    );
    expect(docxResponse.json().data).toMatchObject({ mediaKind: 'docx', parseStatus: 'parsed' });
    expect((context.database.prepare('SELECT context_excerpt FROM author_attachments WHERE attachment_id = ?')
      .get(docxResponse.json().data.attachmentId) as { context_excerpt: string }).context_excerpt).toContain('沈青');

    const pdfResponse = await uploadFile(app, book.bookId, 'evidence.pdf', 'application/pdf', makePdf('PDF attachment evidence'));
    expect(pdfResponse.json().data).toMatchObject({ mediaKind: 'pdf', parseStatus: 'parsed' });
    expect((context.database.prepare('SELECT context_excerpt FROM author_attachments WHERE attachment_id = ?')
      .get(pdfResponse.json().data.attachmentId) as { context_excerpt: string }).context_excerpt).toContain('PDF attachment evidence');

    const blankPdf = await uploadFile(app, book.bookId, 'scan.pdf', 'application/pdf', makePdf(''));
    expect(blankPdf.json().data).toMatchObject({ mediaKind: 'pdf', parseStatus: 'no_text' });
    expect(blankPdf.json().data.parseError).toContain('扫描件');

    const image = await uploadFile(app, book.bookId, 'map.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(image.json().data).toMatchObject({ mediaKind: 'image', parseStatus: 'preview_only', parsedCharCount: 0 });
    const content = await app.inject({
      method: 'GET', url: `/api/v1/books/${book.bookId}/author-attachments/${image.json().data.attachmentId}/content`
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('image/png');
    expect(content.rawPayload).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('拒绝跨书绑定、重复ID和不支持类型，移除待发附件但保留原文件', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '甲书', text: '附件甲' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '乙书', text: '附件乙' });
    app = await createServer(context.config, context.database, { trustedTest: true });

    const upload = await uploadFile(app, first.bookId, 'only-a.txt', 'text/plain', Buffer.from('只属于甲书'));
    const attachmentId = upload.json().data.attachmentId as string;
    const crossBookPayload = {
      surface: 'setting', subjectType: 'setting_module', subjectId: 'cross-book', intentStrength: 'preference',
      originalText: '尝试越权引用', attachmentRefs: [attachmentId], mentionedAgentIds: [], scopeNotes: null,
      idempotencyKey: 'cross-book-attachment'
    };
    const crossBook = await app.inject({
      method: 'POST', url: `/api/v1/books/${second.bookId}/author-planning-inputs`, payload: crossBookPayload
    });
    expect(crossBook.statusCode).toBe(404);
    expect(context.database.prepare('SELECT origin_record_id FROM author_attachments WHERE attachment_id = ?').get(attachmentId))
      .toEqual({ origin_record_id: null });
    const duplicate = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/author-planning-inputs`,
      payload: { ...crossBookPayload, attachmentRefs: [attachmentId, attachmentId], idempotencyKey: 'duplicate-attachment' }
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data.attachmentRefs).toEqual([attachmentId]);

    const unsupported = await uploadFile(app, first.bookId, 'macro.doc', 'application/msword', Buffer.from('not-docx'));
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error.message).toContain('不支持此附件类型');

    const linkedDiscard = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/author-attachments/${attachmentId}/discard`, payload: {}
    });
    expect(linkedDiscard.statusCode).toBe(409);
    const unused = await uploadFile(app, first.bookId, 'unused.txt', 'text/plain', Buffer.from('尚未引用'));
    const discard = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/author-attachments/${unused.json().data.attachmentId}/discard`, payload: {}
    });
    expect(discard.statusCode).toBe(200);
    expect(discard.json().data.parseStatus).toBe('discarded');
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM file_registry WHERE owner_id = ? AND book_id = ?')
      .get(context.config.ownerId, first.bookId)).toEqual({ count: 4 });
  });
});

async function uploadFile(app: FastifyInstance, bookId: string, filename: string, mimeType: string, content: Buffer) {
  const boundary = `----wenmi-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    '', ''
  ].join('\r\n'));
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({
    method: 'POST',
    url: `/api/v1/books/${bookId}/author-attachments`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail])
  });
}

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function makePdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
