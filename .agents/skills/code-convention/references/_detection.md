---
layer: meta
---

# 프로젝트 성격 감지

`code-convention` 스킬 §0이 사용하는 감지 신호표와 판정 표 형식. **새 언어·프레임워크가 조직에 도입되면 이 파일에만 행을 추가한다.** `SKILL.md` 는 건드리지 않는다.

---

## §1. 감지 신호표

**단일 신호로 판정하지 않는다.** 아래는 우선순위가 있는 신호 묶음이며, 1순위 신호가 없을 때 2순위로 내려간다.

| 층 | 레퍼런스 파일 | 1순위 신호 (견고) | 2순위 신호 (폴백) | 프로젝트 루트 |
|---|---|---|---|---|
| framework | `framework-unity.md` | `**/ProjectSettings/ProjectVersion.txt` | — | 그 파일의 **조부모** 디렉터리 |
| framework | `framework-ue.md` | `**/*.uproject` | — | 그 파일의 디렉터리 |
| framework | `framework-dotnet.md` | `appsettings*.json` 또는 `Program.cs` 또는 `global.json`<br>**AND** 상위 트리에 `ProjectSettings/ProjectVersion.txt` 없음 | `*.csproj` (같은 조건) | 그 파일의 디렉터리 |
| framework | `framework-phaser.md` | `package.json` 의 `dependencies` 에 `phaser` | — | 그 `package.json` 의 디렉터리 |
| **platform** | `platform-android.md` | `**/Assets/Plugins/Android/` **또는** 안드로이드 빌드 스크립트(`build-android*`) | `AndroidManifest.xml` 존재 | 해당 Unity 프로젝트 |
| **platform** | `platform-ios.md` | `**/Assets/Plugins/iOS/` **또는** iOS 빌드 스크립트(`build-ios*`) | `.mm`/`.m` 네이티브 소스 존재 | 해당 Unity 프로젝트 |
| **platform** | `platform-webgl.md` | `**/Assets/Plugins/WebGL/` **또는** WebGL 빌드 스크립트(`build-webgl*` · `build-toss*`) | `.jslib` 존재 | 해당 Unity 프로젝트 |
| lang | `lang-csharp.md` | 위 Unity/.NET 루트가 잡히면 자동 | 해당 트리에 `*.cs` 존재 | 해당 트리 |
| lang | `lang-typescript.md` | `tsconfig.json`<br>**AND** Unity 루트 하위가 **아님** | `package.json` + `*.ts` (같은 조건) | 그 파일의 디렉터리 |
| lang | `lang-cpp.md` | `CMakeLists.txt` 또는 `*.vcxproj` | 해당 트리에 `*.cpp`/`*.h` | 해당 트리 |
| project | `project-rules.md` | — | — | **항상 적용** (전역 행 `*`) |

### 웹 프레임워크 판정 — 2단계

`package.json` 의 존재만으로는 프레임워크를 알 수 없다. §2 명령으로 `package.json` 경로를 수집한 뒤, **Unity 루트 하위가 아닌 것만** 골라 그 파일의 `dependencies` / `devDependencies` 를 읽어 판정한다.

| 의존성 | 층 |
|---|---|
| `phaser` | `framework-phaser.md` |
| _(그 외는 필요해질 때 이 표에 추가)_ | |

의존성에 해당 항목이 없으면 프레임워크 층 없이 `lang-typescript.md` 만 적용한다.

### 판정 함정 — 실측으로 확인된 것

1. **`.csproj` 는 신뢰할 수 없는 신호다.** 두 방향으로 틀린다.
   - *거짓 양성*: Unity가 `Assembly-CSharp.csproj` 를 **자동 생성**한다. 이게 있다고 .NET 프로젝트가 아니다.
   - *거짓 음성*: 많은 레포가 그 자동 생성물을 막으려고 `.gitignore` 에 `*.csproj` 를 넣는다. 그러면 **진짜 .NET 서버 프로젝트의 `.csproj` 까지 함께 사라진다.** 신규 클론에서는 존재하지 않는다.
   - 그래서 .NET 1순위 신호는 `appsettings*.json` / `Program.cs` / `global.json` 이다. 이것들은 소스라 gitignore 되지 않는다.

2. **`package.json` 은 Node 신호가 아닐 수 있다.** Unity의 `Assets/` · `Packages/` 하위 `package.json` 은 UPM 패키지 매니페스트다. **Unity 루트 하위면 무시**한다.

3. **`.sln` 도 Unity가 자동 생성**하며 같은 이유로 gitignore 되는 경우가 많다. 보조 신호로만 쓴다.

4. **레퍼런스 파일이 없으면 그 층은 건너뛴다.** 감지는 됐는데 파일이 없다면 그 스택용 레퍼런스가 아직 작성되지 않은 것이다. 판정 표에 `(미작성)` 으로 표기하고 진행한다.

5. **한 레포에 여러 층이 공존한다.** 단일 판정을 내리지 말고 §3 형식으로 **경로별** 기록한다.

6. **명령 출력 = 원시 신호이지 판정이 아니다.** 위 함정 1~3을 적용해 걸러낸 뒤 §3 표를 만든다.

7. **`ProjectSettings.asset` 의 플랫폼 키는 신호가 아니다.** Unity 는 **전 플랫폼의 설정 슬롯을 항상 생성**한다. `iPhone:` · `Android...` 키가 있다고 그 플랫폼을 타깃하는 게 아니다.
   - *실측*: 한 Unity 프로젝트에 `iPhone:` 키가 11군데 있으나 iOS 타깃이 아니다(`Assets/Plugins/iOS/` 없음, iOS 빌드 스크립트 없음).
   - 플랫폼의 실제 신호는 **`Assets/Plugins/<플랫폼>/` 폴더**와 **빌드 스크립트**다.

8. **플랫폼 층은 여러 개가 동시에 잡힌다.** 하나로 좁히려 하지 말 것. 한 Unity 프로젝트가 Android + WebGL 을 함께 타깃하는 것이 정상이다.
   - *실측*: 한 Unity 프로젝트 = `Assets/Plugins/Android/` + `build-android.ps1` + `build-toss.ps1` + `build-webgl.bat` → **android + webgl 2개**.

### 탐색 제외 디렉터리

`node_modules` / `Library` / `Temp` / `obj` / `bin` / `.git` / `Build` / `Builds` / `dist` / `Logs` / `.vs`

---

## §2. 감지 명령 (1회 일괄 실행)

신호별로 탐색을 반복하지 않는다. **한 번의 호출로 전 신호를 수집**한다.

### PowerShell (검증됨)

제외 디렉터리를 **열거하기 전에 가지치기**한다. `-Recurse` 후 필터링하면 Unity `Library/`(에디터를 한 번이라도 열면 10만 파일대) 와 `node_modules` 를 전부 훑고 나서 버리게 되어 급격히 느려진다.

```powershell
$ex = @('node_modules','Library','Temp','obj','bin','.git','Build','Builds','dist','Logs','.vs')
$root = (Get-Location).Path
$q = [System.Collections.Generic.Queue[string]]::new(); $q.Enqueue($root)
$dep = @{ $root = 0 }; $hits = @()
$names = @('ProjectVersion.txt','tsconfig.json','CMakeLists.txt','appsettings.json','global.json','package.json','Program.cs')
$exts  = @('.uproject','.csproj','.vcxproj','.sln')
$plat  = @('Android','iOS','WebGL')          # Assets/Plugins/<플랫폼>
while ($q.Count -gt 0) {
  $d = $q.Dequeue(); if ($dep[$d] -ge 5) { continue }
  foreach ($c in Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue) {
    $rel = $c.FullName.Substring($root.Length + 1)
    if ($c.PSIsContainer) {
      if ($ex -contains $c.Name) { continue }
      if ($plat -contains $c.Name -and $rel -match 'Plugins') { $hits += "[platform] $rel" }
      $dep[$c.FullName] = $dep[$d] + 1; $q.Enqueue($c.FullName)
    } elseif ($names -contains $c.Name -or $exts -contains $c.Extension) {
      $hits += $rel
    } elseif ($c.Name -match '^build[-_].*\.(ps1|bat|sh)$') {
      $hits += "[platform] $rel"
    }
  }
}
$hits | Sort-Object
```

> **실측 (2026-08-19, Unity 미오픈 상태의 3개 레포)**: 가지치기 0.45초 / 29건. 같은 조건에서 `-Recurse` 후 필터링은 2.3초, 그리고 `.csproj` 만 보느라 모노레포의 `Xxx.Server` · `.Api` 를 **놓쳤다.**
> **Unity 오픈 후 Unity 프로젝트 단독 (`Library/` 66,609 파일)**: 가지치기 **0.22초**, 무가지치기 1.72초 — **약 8배.**

`.cs` / `.cpp` 같은 소스 확장자는 위 결과로 프로젝트 루트가 정해진 뒤 **그 루트 한정**으로 확인한다. 전체 재귀 금지 — 파일 수가 많다.

**`[platform]` 로 표시된 항목**은 빌드 스크립트 이름과 `Assets/Plugins/<플랫폼>/` 폴더다. 스크립트 이름에서 플랫폼을 읽는다 — `build-android*` → android, `build-ios*` → ios, `build-webgl*` · `build-toss*` 등 웹 배포 스크립트 → webgl. **이름만으로 플랫폼이 불분명하면 스크립트 안을 열어 확인한다.**

### Glob 도구 대안

셸 권한 문제나 성능 이슈가 있으면 Glob 을 **한 메시지에서 병렬로** 호출한다. 다만 Glob 은 제외 디렉터리 가지치기가 안 되므로 Unity `Library/` 가 큰 레포에서는 느릴 수 있다.

```
**/ProjectSettings/ProjectVersion.txt
**/*.uproject
**/appsettings.json
**/Program.cs
**/tsconfig.json
**/CMakeLists.txt
```

---

## §3. 판정 결과 형식

감지 결과는 **파일로 저장하지 않는다.** 아래 표 형식으로 답변에 남겨 현재 세션 컨텍스트에서만 유지한다.

```markdown
**코드 컨벤션 층 판정**

| 경로 | 적용 층 | 근거 |
|---|---|---|
| `**` (레포 전체) | lang-csharp, framework-unity, **platform-android, platform-webgl** | `ProjectSettings/ProjectVersion.txt` · `Assets/Plugins/Android/` · `BuildScripts/build-android.ps1` · `build-toss.ps1` |
| `*` | project-rules | — |
```

모노레포 예시(서브프로젝트별로 층이 다른 경우):

```markdown
| 경로 | 적용 층 | 근거 |
|---|---|---|
| `Xxx.Client/**` | lang-csharp, framework-unity, platform-android | `Xxx.Client/ProjectSettings/ProjectVersion.txt` |
| `Xxx.Server/**`, `Xxx.Api/**` | lang-csharp, framework-dotnet | `.../appsettings.json` + `Program.cs`, Unity 루트 아님 |
| `*` | project-rules | — |
```

> 위 예시는 실제 레포를 감지한 결과다. `Xxx.Client/Assembly-CSharp.csproj` 가 원시 신호에 잡히지만 **Unity 자동 생성물이라 판정에서 제외**했고, `Server`·`Api` 는 `.csproj` 가 gitignore 되어 있어 `appsettings.json` · `Program.cs` 로 판정했다 (§1 함정 1).

### 기록 규칙

- **근거** 칸에는 실제로 존재를 확인한 파일 경로를 적는다. 판정의 출처가 보여야 오판을 사람이 잡을 수 있다.
- 경로는 **레포 루트 기준 상대 경로**. glob 은 `**` 로 하위 전체를 표기한다.
- 전역 행(`*`, project-rules)은 항상 마지막 행에 둔다.
- 감지했으나 레퍼런스 파일이 없으면 층 이름 뒤에 `(미작성)` 을 붙인다. 예: `framework-godot (미작성)`
- 판정 표는 **처음 감지했을 때 한 번** 답변에 남긴다. 이후 매 작업마다 반복 출력하지 않는다.

### 재판정 시점

스킬은 세션당 한 번 로드되고 판정이 컨텍스트에 남는다. 아래 상황에서는 **판정을 그대로 재사용하지 말고 다시 감지한다.**

| 상황 | 처리 |
|---|---|
| 작업 대상 파일이 판정 표의 어느 행에도 안 속함 | **그 경로만** 추가 감지 후 행 추가 |
| 새 서브프로젝트·모듈 추가 (예: Unity 레포에 .NET 서버가 붙음) | 위와 동일 — 그 경로 작업 시점에 편입 |
| 판정 근거였던 파일이 사라짐 | 전체 재감지 |
| 새 세션 시작 | 스킬 로드 시 자동으로 처음부터 감지 |

전체 재감지는 **근거가 깨졌을 때만** 한다. 그 외에는 해당 경로만 감지한다.
