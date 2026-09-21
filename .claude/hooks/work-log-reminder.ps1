# work-log 스킬 로드 리마인더 (UserPromptSubmit 훅)
#
# [중요] 이 파일은 UTF-8 "with BOM" 으로 저장한다. 저장소 문서 규칙(BOM 없음)의
# 의도적 예외다. PowerShell 5.1 은 BOM 없는 .ps1 을 시스템 ANSI 로 파싱하므로,
# BOM 을 지우면 아래 정규식 안의 한글이 파싱 시점에 깨져 훅이 조용히 죽는다.

# 콘솔을 건드리지 않고 stdin 을 UTF-8 로 직접 연다.
$reader = New-Object System.IO.StreamReader(
    [Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
$raw = $reader.ReadToEnd()

# 입력 JSON 을 파싱하지 않는다. 키워드 포함 여부만 보면 되므로 파서가 필요 없고,
# 파서가 있으면 파서가 깨진다.
# 감지어는 SKILL.md §0 의 트리거와 같게 유지한다.
#
# "마무리" 는 넣지 않는다. session-routine 훅이 이미 잡고 있고, 마무리루틴에서의
# 작업 로그 갱신은 그 스킬 본문(마무리 4단계)이 호출한다. 여기 넣으면 두 훅이
# 같은 발화에 동시에 붙는다.
if ($raw -match '작업 ?로그|작업 ?기록|작업.{0,4}남겨|어디까지 했는지|work-log') {
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Load the work-log skill before touching docs/work-log/. Never rewrite the whole file - change only the lines that need it."}}'
}
