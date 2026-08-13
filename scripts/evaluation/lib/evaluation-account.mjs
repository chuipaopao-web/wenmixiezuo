function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
}

async function send(api, origin, path, body) {
  return fetch(`${api}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site': 'same-site'
    },
    body: JSON.stringify(body)
  });
}

export async function loginEvaluationAccount(options = {}) {
  const api = options.api ?? 'http://127.0.0.1:43111';
  const origin = options.origin ?? 'http://127.0.0.1:43110';
  const email = options.email ?? process.env.WENMI_E2E_EMAIL;
  const password = options.password ?? process.env.WENMI_E2E_PASSWORD;
  const nickname = options.nickname ?? process.env.WENMI_E2E_NICKNAME ?? '验收作者';
  const allowRegistration = options.allowRegistration ?? process.env.WENMI_E2E_REGISTER === '1';
  if (!email || !password) {
    throw new Error('验收脚本需要 WENMI_E2E_EMAIL 和 WENMI_E2E_PASSWORD，且使用真实账号登录。');
  }

  let response = await send(api, origin, '/api/v1/auth/login', { email, password });
  if (!response.ok && allowRegistration) {
    response = await send(api, origin, '/api/v1/auth/register', { email, password, displayName: nickname });
  }
  if (!response.ok) {
    throw new Error(`验收账号登录失败（${response.status}）：${await response.text()}`);
  }
  const cookie = cookieFrom(response);
  if (cookie.length === 0) throw new Error('验收账号登录成功，但服务端没有签发安全会话。');
  return cookie;
}
