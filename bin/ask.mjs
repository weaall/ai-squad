// `squad ask` 옵션 → 입력 요청 객체. 검증(비밀값 칸 거부 포함)은 lib/input.mjs 의 validateInputRequest 가 한다.
import path from 'node:path';

const parts = (s) => String(s ?? '').split('|');

/** kind: preview|choice|form. o: { text, to, subject, body, option: ['id|라벨|캡처'], field: ['name[*]|라벨'] } */
export function askRequest(from, kind, title, o = {}) {
  const k = kind === 'form' ? 'fields' : kind;
  const r = { from, kind: k, title, text: o.text };
  if (k === 'preview') r.preview = { to: o.to, subject: o.subject, body: o.body };
  if (k === 'choice') {
    r.options = (o.option || []).map((s) => {
      const p = parts(s);
      // 캡처는 경로로 줘도 된다 — 파일 이름만 남긴다.
      return { id: p[0], label: p.slice(1, -1).join('|'), capture: p.length > 2 ? path.basename(p.at(-1)) : undefined };
    });
  }
  if (k === 'fields') {
    r.fields = (o.field || []).map((s) => {
      const [name, ...label] = parts(s);
      const req = name.endsWith('*');
      return { name: req ? name.slice(0, -1) : name, label: label.join('|'), ...(req ? { required: true } : {}) };
    });
  }
  return r;
}
