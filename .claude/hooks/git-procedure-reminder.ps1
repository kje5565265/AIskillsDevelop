# git-procedure 스킬 로드 리마인더 (UserPromptSubmit 훅)
#
# [중요] 이 파일은 UTF-8 "with BOM" 으로 저장한다. 저장소 문서 규칙(BOM 없음)의
# 의도적 예외다. PowerShell 5.1 은 BOM 없는 .ps1 을 시스템 ANSI 로 파싱하므로,
# BOM 을 지우면 아래 정규식 안의 한글이 파싱 시점에 깨져 훅이 조용히 죽는다.

# 콘솔을 건드리지 않고 stdin 을 UTF-8 로 직접 연다.
# [Console]::InputEncoding 을 세우면 콘솔 핸들이 없을 때 예외로 죽고,
# 성공해도 사용자 터미널의 코드페이지를 전역으로 바꾼다.
$reader = New-Object System.IO.StreamReader(
    [Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
$raw = $reader.ReadToEnd()

# 입력 JSON 을 파싱하지 않는다. 키워드 포함 여부만 보면 되므로 파서가 필요 없고,
# 파서가 있으면 파서가 깨진다.
if ($raw -match '깃|\bgit|커밋|푸시|올려줘|commit|push|pull') {
    '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Load the git-procedure skill before staging, committing, pulling or pushing."}}'
}
