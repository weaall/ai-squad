// 외부 runner 의 API 키 — 사용자 프로필 아래에만 둔다(Windows: %APPDATA%\ai-squad\secrets.json). 저장소에 두지 않는다.
// 보드는 "설정됨" 여부만 본다. 값은 runner 를 실행할 때 환경 변수로만 넘긴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function secretsFile() {
  if (process.env.SQUAD_SECRETS) return process.env.SQUAD_SECRETS; // 시험용
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'ai-squad', 'secrets.json');
}

function readAll() {
  try {
    const j = JSON.parse(fs.readFileSync(secretsFile(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

export function getSecret(name) {
  const v = readAll()[name];
  return typeof v === 'string' ? v : '';
}
export const hasSecret = (name) => Boolean(getSecret(name));

/** value 가 빈 문자열이면 지운다. */
export function setSecret(name, value) {
  const all = readAll();
  if (value) all[name] = value;
  else delete all[name];
  const file = secretsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2), { encoding: 'utf8', mode: 0o600 });
}
