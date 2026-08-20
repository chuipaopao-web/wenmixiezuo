import { toAuthorFacingText } from '../../app/author-presentation';

const INTERNAL_ERROR = /(?:owner[_ ]?id|book[_ ]?id|uuid|json|schema|sql|repository|worker|lease|栅栏|哈希|快照|序列化|反序列化|model[_ ]?snapshot|source[_ ]?id)/iu;

/** 把服务端内部错误换成作者知道该怎么处理的话；原错误仍由服务端记录。 */
export function authorErrorMessage(message: string, status?: number): string {
  const text = message.trim();
  if (text.length === 0) return '这次操作没有完成，请稍后再试。';
  if (/已定稿正史不能删除|正史已结算正文只读|已结算.*只读/u.test(text)) {
    return '这章已经定稿，不能直接覆盖或删除。需要修改时，请另存一份修改稿。';
  }
  if (/修订已变化|版本.*(?:冲突|过期)|陈旧/u.test(text)) {
    return '你看到的内容已经更新。请刷新页面，确认最新内容后再试。';
  }
  if (/跨书|不属于当前书|书籍隔离/u.test(text)) {
    return '这份内容不属于当前这本书。请回到正确的书再操作。';
  }
  if (INTERNAL_ERROR.test(text) || (status !== undefined && status >= 500)) {
    return '这次操作没有完成。请稍后再试；如果仍然失败，请重新打开这本书。';
  }
  return toAuthorFacingText(text
    .replaceAll('正史修订', '已确认内容')
    .replaceAll('正史', '已经确认的内容')
    .replaceAll('候选', '待确认内容')
    .replaceAll('落库', '保存'), 'error');
}

/**
 * 页面层唯一允许的异常展示入口。无论异常来自请求、浏览器还是本地处理，
 * 都先经过作者错误门；服务端原始错误仍保留在日志与审计记录中。
 */
export function authorErrorFromUnknown(reason: unknown, fallback = '这次操作没有完成，请稍后再试。'): string {
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string'
      ? reason
      : fallback;
  const sanitized = authorErrorMessage(message);
  return sanitized.trim().length > 0 ? sanitized : authorErrorMessage(fallback);
}