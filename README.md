# AI_Develop

AI 개발 인프라.

AI 에이전트(Claude Code · Codex · Cursor)가 실 프로젝트에서 **지켜야 할 규칙을 스킬로 만들어 각 프로젝트에 배포**한다.

---

## 왜 필요한가

규칙을 `CLAUDE.md` 한 파일에 쌓으면 두 가지 문제가 생긴다.

1. **매 세션 전부 상주**한다 — 비용은 드는데 정작 코딩하는 순간엔 주의가 흐려진다
2. **프로젝트 고유 규칙과 일반 규칙이 섞인다** — 다른 프로젝트에 재사용할 수 없다

그래서 규칙을 **층으로 나누고, 코드를 건드릴 때만 해당 층을 로드**한다.

```
설계 원칙  →  언어  →  프레임워크  →  플랫폼  →  프로젝트 고유
  (L1)      (L2)       (L3)        (L3.5)        (L4)
```

저장소를 스캔해 어느 층이 해당하는지 **자동 판정**한다. 예를 들어 Android · WebGL 빌드를 가진 Unity 프로젝트는 `C# + Unity + Android + WebGL` 로 판정되어 그 층들만 읽는다.

---

## 무엇이 달라지는가

| 질문 | 규칙 없을 때 | 있을 때 |
|---|---|---|
| "CSV 테이블 값 하나만 고쳐줘" | CSV만 수정 ❌ | xlsx 도 같이 갱신 — CSV만 고치면 다음 Export 에서 사라짐 |
| "SerializeField 필드 이름 바꿔줘" | 그냥 변경 ❌ | `[FormerlySerializedAs]` 없으면 인스펙터 값이 조용히 소실 |
| "무거운 계산을 `Task.Run` 으로 돌릴까?" | "네" ❌ | WebGL 은 스레드가 없어 런타임 실패 |

---

## 저장소 구조

```
.claude/skills/        스킬 마스터 (각 프로젝트로 배포되는 원본)
.agents/skills/        Codex · Cursor 용 동일 복사본
templates/             배포용 CLAUDE.md · AGENTS.md · docs 골격
docs/skills/           스킬 설계 (스킬별 폴더)
docs/develop-history/  개발 이력
docs/work-log/         작업 로그
CLAUDE.md · AGENTS.md  이 저장소에서 작업할 때의 가이드 (바이트 동일)
```

---

## 시작하기

| 하려는 것 | 읽을 문서 |
|---|---|
| 이 저장소에서 작업 | [`CLAUDE.md`](CLAUDE.md) |
| 스킬 내용 확인 | [`.claude/skills/`](.claude/skills/) |
| 스킬 설계 · 결정 근거 | [`docs/skills/`](docs/skills/) |
| 스킬 개발 · 배포 절차 | [`.claude/skills/skill-pipeline/SKILL.md`](.claude/skills/skill-pipeline/SKILL.md) |

---

## 프로젝트 팀이 알아야 할 것

1. **새로 정해진 코드 규칙은 `CLAUDE.md` 가 아니라** 각 프로젝트의 `.claude/skills/code-convention/references/project-rules.md` **에 추가**한다
2. **Cursor 는 2.4 이상**이어야 한다 — 그 아래는 스킬 인식 자체가 안 된다
3. 규칙 위반으로 사고가 나면 `project-rules.md` **§9 실사례 로그**에 한 줄 남긴다 — 원칙만 있는 문서보다 사례가 붙은 문서가 훨씬 잘 지켜진다
