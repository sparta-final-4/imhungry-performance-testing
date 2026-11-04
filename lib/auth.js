// 부하 테스트 스크립트가 같이 쓰는 로그인·CSRF 공용 함수.
// 이 서버는 로그인하면 access_token 쿠키를 주고, 변경 요청(POST·PATCH·DELETE)에는 CSRF 헤더가 더 필요하다.
import http from 'k6/http';
import { check, fail } from 'k6';

// 대상 서버 주소. 다른 서버를 재려면 -e BASE_URL=... 로 바꾼다.
export const BASE = __ENV.BASE_URL || 'http://localhost:8080';

// 테스트 회원은 모두 같은 비밀번호를 쓴다(비밀번호 규칙: 영문·숫자·특수문자 포함 8자 이상).
export const PASSWORD = 'Loadtest1!';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 테스트 회원 번호 → 이메일. 번호 1번이면 loadtest-1@example.com.
export function memberEmail(index) {
  return `loadtest-${index}@example.com`;
}

// 테스트 회원을 만든다(회원가입 API). 이미 있으면 서버가 중복(409)으로 거절하는데, 그대로 두고 무시한다.
// 409는 정상 응답으로 분류해 실패율 지표(http_req_failed)와 자동 중단 조건에 들어가지 않게 한다.
// 닉네임과 전화번호도 번호로 만들어 겹치지 않게 한다(전화번호는 010-9000-0001 형식).
export function signUp(index) {
  const phone = `010-9000-${String(index).padStart(4, '0')}`;
  return http.post(
    `${BASE}/api/members`,
    JSON.stringify({
      email: memberEmail(index),
      password: PASSWORD,
      nickname: `loadtest${index}`,
      phone,
      tastes: ['SALTY'],
    }),
    { headers: JSON_HEADERS, responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 409) },
  );
}

// 로그인해서 이후 요청에 붙일 쿠키 헤더({ Cookie: ... })를 돌려준다.
// 첫 인자가 숫자면 테스트 회원 번호, 문자열이면 그 이메일(관리자 등)로 로그인한다.
// 로컬 http에서는 서버가 Secure 쿠키를 주는데 k6의 쿠키 저장소가 이를 http 요청에 안 붙인다.
// 그래서 응답 쿠키를 직접 꺼내 헤더로 붙인다.
export function login(who, password) {
  const email = typeof who === 'number' ? memberEmail(who) : who;
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email, password: password || PASSWORD }),
    { headers: JSON_HEADERS, jar: new http.CookieJar() },
  );
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  if (!ok) fail(`login 실패 (${email}): ${res.status} ${res.body}`);

  const access = res.cookies.access_token && res.cookies.access_token[0].value;
  const refresh = res.cookies.refresh_token && res.cookies.refresh_token[0].value;
  return { Cookie: `access_token=${access}; refresh_token=${refresh}` };
}

// 변경 요청(POST·PATCH·DELETE)에 필요한 CSRF 헤더를 돌려준다. login()이 돌려준 값을 넘긴다.
// 서버는 XSRF-TOKEN 쿠키 값을 그대로 X-XSRF-TOKEN 헤더로 받는다.
// 응답 본문의 token은 가려진(마스킹된) 값이라 쓰면 403(AUTH_002)이 난다.
export function csrf(authHeaders) {
  const res = http.get(`${BASE}/api/auth/csrf`, {
    headers: authHeaders,
    jar: new http.CookieJar(),
  });
  const xsrf = res.cookies['XSRF-TOKEN'] && res.cookies['XSRF-TOKEN'][0].value;
  if (!xsrf) fail(`XSRF-TOKEN 쿠키를 못 받음: ${res.status} ${res.body}`);
  const headerName = res.json('data.headerName');
  return {
    ...authHeaders,
    Cookie: `${authHeaders.Cookie}; XSRF-TOKEN=${xsrf}`,
    [headerName]: xsrf,
  };
}
