// project-report 수집기 — 보고 전용 복제본에서 커밋 기록을 모아 JSON 으로 떨군다.
//
// 설정은 저장소가 아니라 이 PC 에만 있다 — ~/.project-report/config.json
// (환경 변수 PROJECT_REPORT_HOME 으로 위치를 바꿀 수 있다). 어느 조직에서든 같은 스킬을 쓰고,
// 추적할 프로젝트만 PC 마다 등록한다.
//
// 사용
//   node collect.mjs init [--base-dir <경로>]                     설정 파일을 만든다
//   node collect.mjs add --url <저장소 주소> [--key k] [--name N] [--alias a,b] [--exclude g1,g2] [--no-check]
//   node collect.mjs map <key> <브랜치> --platform <이름> [--prefix "and -"]   브랜치를 출시 라인으로 표시
//   node collect.mjs unmap <key> <브랜치>
//   node collect.mjs remove <key>
//   node collect.mjs list                                         설정 위치와 등록된 프로젝트
//   node collect.mjs report [--project <key|이름>]   지난 보고 이후를 수집 (fetch 포함)
//   node collect.mjs redo   [--project <key|이름>]   마지막 보고의 범위를 그대로 다시 수집 (기준점 불변)
//   node collect.mjs commit <collect-파일>           report 결과로 기준점을 옮긴다
//
// 셸을 거치지 않고 git 출력을 UTF-8 로 직접 받는다 — PowerShell 5.1 을 거치면 한글 커밋 메시지가 깨진다.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const EXAMPLE_PATH = path.join(SCRIPT_DIR, '..', 'config.example.json')
const CONFIG_HOME = expandHome(process.env.PROJECT_REPORT_HOME ?? path.join(os.homedir(), '.project-report'))
const CONFIG_PATH = path.join(CONFIG_HOME, 'config.json')

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_BUFFER = 256 * 1024 * 1024
const REC = '\x1e'
const FLD = '\x1f'
const LOG_FORMAT = `--format=${REC}%H${FLD}%aN${FLD}%aI${FLD}%s${FLD}%b${FLD}`
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

// 설정을 읽은 뒤 채워진다 — 등록 명령은 설정 없이도 돌아야 해서 모듈 머리에서 읽지 않는다
let CONFIG
let BASE_DIR
let MIRROR_DIR
let WORK_DIR
let STATE_PATH
let STATE_PREV_PATH
let DOC_PATTERNS

class CollectError extends Error {}

function expandHome(p) {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p
}

function useConfig(config) {
  CONFIG = config
  BASE_DIR = path.resolve(expandHome(config.baseDir ?? CONFIG_HOME))
  MIRROR_DIR = path.join(BASE_DIR, 'mirrors')
  WORK_DIR = path.join(BASE_DIR, 'work')
  STATE_PATH = path.join(BASE_DIR, 'state.json')
  STATE_PREV_PATH = path.join(BASE_DIR, 'state.prev.json')
  DOC_PATTERNS = (config.docPathPatterns ?? []).map((p) => new RegExp(p))
}

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new CollectError(
      `설정이 없다 — ${CONFIG_PATH}\n` +
        '  node collect.mjs init 으로 만들고, add --url <저장소 주소> 로 추적할 프로젝트를 등록한다',
    )
  }
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (!Array.isArray(config.projects)) throw new CollectError('projects 목록이 없음')
    return config
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new CollectError(`설정을 읽을 수 없다 — ${CONFIG_PATH} (${reason})`)
  }
}

function loadConfig() {
  const config = readConfigFile()
  useConfig(config)
  return config
}

function writeAtomic(filePath, text) {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, filePath)
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_HOME, { recursive: true })
  writeAtomic(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
}

function git(repoDir, args, { timeoutMs, allowFail = false } = {}) {
  const result = spawnSync(
    'git',
    ['-C', repoDir, '-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8', ...args],
    {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      // 인증 창이 뜨면 비대화형 실행이 무한 대기한다 — 실패로 끝나게 한다
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    },
  )
  const isOk = result.status === 0 && !result.error
  if (!isOk && !allowFail) {
    throw new CollectError(`git ${args.join(' ')} 실패: ${result.error?.message ?? result.stderr.trim()}`)
  }
  return { isOk, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error }
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { state: { version: 1, projects: {} }, isCorrupt: false }
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    if (typeof state !== 'object' || state === null || typeof state.projects !== 'object') {
      throw new CollectError('형식이 맞지 않음')
    }
    return { state, isCorrupt: false }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.error(`기준점 기록을 읽을 수 없음 — 첫 보고처럼 처리한다 (${reason})`)
    return { state: { version: 1, projects: {} }, isCorrupt: true }
  }
}

function findProjects(projects, filter) {
  const needle = filter.toLowerCase()
  return projects.filter(
    (p) => p.key === needle || p.repo.toLowerCase() === needle || p.name.toLowerCase() === needle || (p.aliases ?? []).some((a) => a.toLowerCase() === needle),
  )
}

function selectProjects(filter) {
  if (CONFIG.projects.length === 0) {
    throw new CollectError(`등록된 프로젝트가 없다 — add --url <저장소 주소> 로 등록한다 (${CONFIG_PATH})`)
  }
  if (filter === undefined) return CONFIG.projects
  const hit = findProjects(CONFIG.projects, filter)
  if (hit.length === 0) throw new CollectError(`설정에 없는 프로젝트: ${filter}`)
  return hit
}

function ensureMirror(project) {
  const repoDir = path.join(MIRROR_DIR, `${project.repo}.git`)
  const timeoutMs = CONFIG.fetchTimeoutSec * 1000
  if (!fs.existsSync(repoDir)) {
    fs.mkdirSync(MIRROR_DIR, { recursive: true })
    // 기록만 받는다 — 파일 내용 · LFS 없이. 작업 폴더도 만들지 않는다
    git(MIRROR_DIR, ['clone', '--bare', '--filter=blob:none', '--no-tags', project.url, repoDir], { timeoutMs })
    git(repoDir, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*'])
  }
  let fetch = git(repoDir, ['fetch', '--prune', '--no-auto-gc', '--no-tags', 'origin'], { timeoutMs, allowFail: true })
  if (!fetch.isOk && /cannot lock ref|unable to lock/i.test(fetch.stderr)) {
    fetch = git(repoDir, ['fetch', '--prune', '--no-auto-gc', '--no-tags', 'origin'], { timeoutMs, allowFail: true })
  }
  const fetchedAt = fs.existsSync(path.join(repoDir, 'FETCH_HEAD'))
    ? fs.statSync(path.join(repoDir, 'FETCH_HEAD')).mtime.toISOString()
    : undefined
  return { repoDir, fetch: describeFetch(fetch), fetchedAt }
}

function describeFetch(fetch) {
  if (fetch.isOk) return { status: 'ok' }
  const message = (fetch.error?.message ?? fetch.stderr).trim()
  // 「not found」 · 403 은 네트워크가 아니라 계정 문제다 — 한 PC 에 계정이 여럿 있으면 흔하다
  const kind = /not found|403|authentication|could not read username/i.test(message) ? 'auth' : 'network'
  return { status: 'failed', kind, message }
}

function listBranches(repoDir, project) {
  const excludes = (project.exclude ?? []).map(globToRegExp)
  const out = git(repoDir, ['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads']).stdout
  const tips = {}
  for (const line of out.split('\n')) {
    const [name, sha] = line.split('\t')
    if (!name || !sha || excludes.some((re) => re.test(name))) continue
    tips[name] = sha
  }
  return tips
}

function commitExists(repoDir, sha) {
  return git(repoDir, ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }).isOk
}

function isAncestor(repoDir, older, newer) {
  return git(repoDir, ['merge-base', '--is-ancestor', older, newer], { allowFail: true }).isOk
}

function sinceIso(days, now) {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

// 브랜치 하나의 수집 범위를 git 인자로 정한다. redo 가 같은 인자를 그대로 재사용한다
function planRange(repoDir, branch, tip, prevTips, isFirst, now) {
  if (isFirst) {
    return { kind: 'first', args: [tip, `--since=${sinceIso(CONFIG.firstReportDays, now)}`] }
  }
  const from = prevTips[branch]
  if (from === tip) return { kind: 'unchanged', args: undefined }
  if (from !== undefined && commitExists(repoDir, from)) {
    if (isAncestor(repoDir, from, tip)) return { kind: 'range', args: [tip, '--not', from] }
    // 강제 푸시 · 리베이스 — 같은 변경을 다시 보고하지 않도록 변경 내용 기준으로 걷어낸다
    return { kind: 'rewritten', args: ['--cherry-pick', '--right-only', `${from}...${tip}`] }
  }
  // 새 브랜치 또는 옛 끝이 사라진 브랜치 — 하한이 없으면 첫 커밋부터 전부 쏟아진다
  const excludes = Object.values(prevTips).filter((sha) => sha !== tip && commitExists(repoDir, sha))
  const kind = from === undefined ? 'new-branch' : 'lost-base'
  const args = [tip, ...(excludes.length > 0 ? ['--not', ...excludes] : []), `--since=${sinceIso(CONFIG.newBranchDays, now)}`]
  return { kind, args }
}

function readCommits(repoDir, rangeArgs) {
  const out = git(repoDir, ['log', '--no-merges', '--no-renames', '--name-only', LOG_FORMAT, ...rangeArgs]).stdout
  const commits = []
  for (const record of out.split(REC)) {
    if (record.trim() === '') continue
    const [sha, author, date, subject, body, rest = ''] = record.split(FLD)
    const files = rest.split('\n').map((f) => f.trim()).filter((f) => f !== '')
    const isDocOnly = files.length > 0 && files.every((f) => DOC_PATTERNS.some((re) => re.test(f)))
    commits.push({
      sha: sha.trim(),
      author,
      date,
      subject,
      body: body.trim().slice(0, CONFIG.bodyMaxChars),
      fileCount: files.length,
      isDocOnly,
      // 다른 PC 에서 잘못된 인코딩으로 커밋된 메시지 — 해석하지 말고 판독 불가로 보고한다
      isGarbled: subject.includes('�'),
    })
  }
  return commits
}

function describeRemovedBranches(repoDir, prevTips, tips) {
  const removed = []
  for (const [branch, sha] of Object.entries(prevTips)) {
    if (tips[branch] !== undefined) continue
    const exists = commitExists(repoDir, sha)
    const containedIn = exists
      ? git(repoDir, ['branch', '--contains', sha, '--format=%(refname:short)'], { allowFail: true })
          .stdout.split('\n').map((s) => s.trim()).filter((s) => s !== '')
      : []
    removed.push({ branch, isMerged: containedIn.length > 0, containedIn })
  }
  return removed
}

function branchMeta(project, branch) {
  const mapped = project.branches?.[branch]
  return { platform: mapped?.platform, prefix: mapped?.prefix, isMapped: mapped !== undefined }
}

function collectReport(projects, state, isStateCorrupt, now) {
  const result = []
  for (const project of projects) {
    const { repoDir, fetch, fetchedAt } = ensureMirror(project)
    const prev = state.projects[project.key]
    const prevTips = prev?.tips ?? {}
    const isFirst = prev === undefined
    const tips = listBranches(repoDir, project)
    const branches = []
    for (const [branch, tip] of Object.entries(tips)) {
      const range = planRange(repoDir, branch, tip, prevTips, isFirst, now)
      const commits = range.args === undefined ? [] : readCommits(repoDir, range.args)
      branches.push({ branch, ...branchMeta(project, branch), tip, rangeKind: range.kind, rangeArgs: range.args, commits })
    }
    result.push({
      key: project.key,
      name: project.name,
      fetch,
      fetchedAt,
      isFirst,
      previousReportAt: prev?.lastReport?.at,
      tips,
      removedBranches: describeRemovedBranches(repoDir, prevTips, tips),
      branches,
    })
  }
  return { mode: 'report', createdAt: now.toISOString(), isStateCorrupt, projects: result }
}

function collectRedo(projects, state, now) {
  const result = []
  for (const project of projects) {
    const last = state.projects[project.key]?.lastReport
    if (last === undefined) throw new CollectError(`${project.name} — 다시 만들 마지막 보고가 없음`)
    const repoDir = path.join(MIRROR_DIR, `${project.repo}.git`)
    const branches = last.branches.map((b) => ({
      branch: b.branch,
      ...branchMeta(project, b.branch),
      tip: b.tip,
      rangeKind: b.rangeKind,
      rangeArgs: b.rangeArgs,
      commits: b.rangeArgs === undefined ? [] : readCommits(repoDir, b.rangeArgs),
    }))
    result.push({
      key: project.key,
      name: project.name,
      reportAt: last.at,
      previousReportAt: last.previousReportAt,
      removedBranches: last.removedBranches ?? [],
      branches,
    })
  }
  return { mode: 'redo', createdAt: now.toISOString(), projects: result }
}

function commitState(collectPath) {
  const collected = JSON.parse(fs.readFileSync(collectPath, 'utf8'))
  if (collected.mode !== 'report') throw new CollectError('report 로 만든 수집 결과만 기준점을 옮길 수 있다')
  const { state, isCorrupt } = loadState()
  if (isCorrupt) {
    // 깨진 기록은 덮어쓰지 않고 남긴다 — 원인을 나중에 볼 수 있게
    fs.renameSync(STATE_PATH, path.join(BASE_DIR, `state.corrupt-${stamp(new Date())}.json`))
  } else if (fs.existsSync(STATE_PATH)) {
    fs.copyFileSync(STATE_PATH, STATE_PREV_PATH)
  }
  for (const p of collected.projects) {
    state.projects[p.key] = {
      tips: p.tips,
      lastReport: {
        at: collected.createdAt,
        previousReportAt: p.previousReportAt,
        removedBranches: p.removedBranches,
        branches: p.branches.map(({ branch, tip, rangeKind, rangeArgs }) => ({ branch, tip, rangeKind, rangeArgs })),
      },
    }
  }
  fs.mkdirSync(BASE_DIR, { recursive: true })
  writeAtomic(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
  return collected.projects.map((p) => p.name)
}

// 플랫폼 라인 사이에서 머리말을 뗀 제목이 **완전히 같은** 작업을 모은다.
// 비슷한 문구는 묶지 않는다 — 흔한 문구가 서로 다른 작업을 하나로 만들고, 그 판단을 AI 추측에 맡기지 않기 위해서다
function buildPlatformMatrix(project) {
  const configOrder = Object.keys(CONFIG.projects.find((p) => p.key === project.key)?.branches ?? {})
  const lines = project.branches
    .filter((b) => b.isMapped && b.commits.length > 0)
    .sort((a, b) => configOrder.indexOf(a.branch) - configOrder.indexOf(b.branch))
  if (lines.length < 2) return undefined
  const rows = new Map()
  for (const b of lines) {
    for (const c of b.commits) {
      if (c.isDocOnly || c.isGarbled) continue
      const title = b.prefix !== undefined && c.subject.startsWith(b.prefix) ? c.subject.slice(b.prefix.length).trim() : c.subject.trim()
      const row = rows.get(title) ?? { title, platforms: new Set(), body: c.body.split('\n').find((l) => l.trim() !== '')?.trim() }
      row.platforms.add(b.platform)
      rows.set(title, row)
    }
  }
  return { platforms: lines.map((b) => b.platform), rows: [...rows.values()].sort((a, b) => b.platforms.size - a.platforms.size) }
}

// AI 가 읽는 요약본. 전체 JSON 은 커밋이 많은 프로젝트 한 주만으로 수백 KB 라 한 번에 읽기 어렵다 — 기록 커밋은 건수만 남긴다
function buildDigest(collected) {
  const lines = [`# 수집 요약 (${collected.mode}) — ${collected.createdAt}`, '']
  if (collected.isStateCorrupt) lines.push('! 기준점 기록이 깨져 첫 보고처럼 수집했다 — 이전 보고와 겹칠 수 있음', '')
  for (const p of collected.projects) {
    lines.push(`## ${p.name}`)
    if (p.fetch !== undefined && p.fetch.status !== 'ok') {
      lines.push(`! fetch 실패 (${p.fetch.kind}) — ${p.fetchedAt ?? '알 수 없음'} 기준 기록으로 수집: ${p.fetch.message}`)
    }
    lines.push(`지난 보고: ${p.previousReportAt ?? '없음 (첫 보고)'}`)
    for (const r of p.removedBranches) {
      lines.push(`! 사라진 브랜치 ${r.branch} — ${r.isMerged ? `합쳐짐 (${r.containedIn.join(', ')})` : '합쳐지지 않음'}`)
    }
    const matrix = buildPlatformMatrix(p)
    if (matrix !== undefined) {
      lines.push(`### 플랫폼 대조 — ${matrix.platforms.join(' · ')} (머리말 뗀 제목이 같은 것만 한 줄)`)
      for (const row of matrix.rows) {
        const marks = matrix.platforms.map((pf) => (row.platforms.has(pf) ? '●' : '—')).join(' ')
        lines.push(`- [${marks}] ${row.title}${row.body ? ` // ${row.body.slice(0, 120)}` : ''}`)
      }
    }
    for (const b of p.branches) {
      const label = b.isMapped ? `${b.platform} (${b.branch})` : `${b.branch} — 대응표에 없음`
      if (b.commits.length === 0) {
        lines.push(`### ${label} — 변동 없음`)
        continue
      }
      const docCount = b.commits.filter((c) => c.isDocOnly).length
      const garbledCount = b.commits.filter((c) => c.isGarbled).length
      lines.push(`### ${label} — 범위 ${b.rangeKind} · 작업 커밋 ${b.commits.length - docCount} · 기록 커밋 ${docCount}${garbledCount > 0 ? ` · 판독 불가 ${garbledCount}` : ''}`)
      for (const c of b.commits) {
        if (c.isDocOnly || c.isGarbled) continue
        const firstBodyLine = c.body.split('\n').find((l) => l.trim() !== '')?.trim().slice(0, 120)
        lines.push(`- ${c.date.slice(0, 10)} ${c.author} | ${c.subject}${firstBodyLine ? ` // ${firstBodyLine}` : ''}`)
      }
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function printSummary(collected, outPath) {
  console.log(`수집 결과: ${outPath}`)
  for (const p of collected.projects) {
    const fetchNote = p.fetch === undefined ? '' : p.fetch.status === 'ok' ? '' : ` [fetch 실패: ${p.fetch.kind}]`
    console.log(`- ${p.name}${fetchNote}`)
    for (const b of p.branches) {
      if (b.commits.length === 0) continue
      const docs = b.commits.filter((c) => c.isDocOnly).length
      console.log(`    ${b.platform ?? b.branch} (${b.rangeKind}) 커밋 ${b.commits.length} · 기록 ${docs}`)
    }
    for (const r of p.removedBranches) console.log(`    사라진 브랜치 ${r.branch} (${r.isMerged ? '합쳐짐' : '합쳐지지 않음'})`)
  }
}

// ── 등록 명령 ─────────────────────────────────────────────

function parseArgs(rest) {
  const flags = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const name = a.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true
    } else {
      flags[name] = next
      i++
    }
  }
  return { flags, positional }
}

function splitList(value) {
  return typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter((s) => s !== '') : []
}

function cmdInit(flags) {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`이미 있다 — ${CONFIG_PATH} (덮어쓰지 않는다)`)
    return
  }
  const example = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'))
  const config = { ...example, projects: [] }
  delete config.$comment
  // 기본은 설정과 같은 폴더다 — 예시에 값이 있어도 따라가지 않는다
  delete config.baseDir
  if (typeof flags['base-dir'] === 'string') config.baseDir = flags['base-dir']
  saveConfig(config)
  console.log(`설정을 만들었다 — ${CONFIG_PATH}`)
  console.log(`기록 · 복제본 · 보고서 위치: ${path.resolve(expandHome(config.baseDir ?? CONFIG_HOME))}`)
  console.log('다음: node collect.mjs add --url <저장소 주소>')
}

function repoNameFromUrl(url) {
  const last = url.replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '')
}

function cmdAdd(flags) {
  const config = readConfigFile()
  const url = flags.url
  if (typeof url !== 'string') throw new CollectError('--url <저장소 주소> 가 필요하다')
  const repo = repoNameFromUrl(url)
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) throw new CollectError(`주소에서 저장소 이름을 읽을 수 없다: ${url}`)
  const key = typeof flags.key === 'string' ? flags.key.toLowerCase() : repo.toLowerCase()
  if (!KEY_PATTERN.test(key)) throw new CollectError(`key 는 영문 소문자 · 숫자 · - · _ 만 쓴다: ${key}`)
  const name = typeof flags.name === 'string' ? flags.name : repo
  const dup = config.projects.find((p) => p.key === key || p.url === url || p.repo.toLowerCase() === repo.toLowerCase())
  if (dup !== undefined) throw new CollectError(`이미 등록됨 — ${dup.key} (${dup.url})`)

  if (flags['no-check'] !== true) {
    // 등록 전에 이 PC 의 계정으로 읽히는지 본다 — 안 읽히는 주소를 등록하면 보고 때마다 실패한다
    const probe = git(process.cwd(), ['ls-remote', '--heads', url], { timeoutMs: (config.fetchTimeoutSec ?? 120) * 1000, allowFail: true })
    if (!probe.isOk) {
      const d = describeFetch(probe)
      throw new CollectError(`저장소를 읽을 수 없다 (${d.kind}) — ${d.message}\n  계정 문제면 이 PC 의 git 인증을 먼저 맞춘다. 확인 없이 등록하려면 --no-check`)
    }
  }

  const project = {
    key,
    name,
    aliases: splitList(flags.alias),
    repo,
    url,
    branches: {},
    exclude: flags.exclude === undefined ? ['wip/*'] : splitList(flags.exclude),
  }
  config.projects.push(project)
  saveConfig(config)
  console.log(`등록했다 — ${name} (key: ${key})`)
  console.log('출시 라인이 브랜치로 나뉘면: node collect.mjs map <key> <브랜치> --platform <이름> [--prefix "<머리말>"]')
}

function requireProject(config, keyOrName) {
  if (keyOrName === undefined) throw new CollectError('프로젝트 key 가 필요하다')
  const hit = findProjects(config.projects, keyOrName)
  if (hit.length === 0) throw new CollectError(`설정에 없는 프로젝트: ${keyOrName}`)
  return hit[0]
}

function cmdMap(positional, flags) {
  const config = readConfigFile()
  const project = requireProject(config, positional[0])
  const branch = positional[1]
  if (branch === undefined) throw new CollectError('브랜치 이름이 필요하다')
  if (typeof flags.platform !== 'string') throw new CollectError('--platform <이름> 이 필요하다 — 예: 안드로이드')
  project.branches = { ...project.branches, [branch]: { platform: flags.platform, ...(typeof flags.prefix === 'string' ? { prefix: flags.prefix } : {}) } }
  saveConfig(config)
  console.log(`${project.name} — ${branch} → 「${flags.platform}」 라인으로 표시했다`)
}

function cmdUnmap(positional) {
  const config = readConfigFile()
  const project = requireProject(config, positional[0])
  const branch = positional[1]
  if (branch === undefined || project.branches?.[branch] === undefined) throw new CollectError(`대응표에 없는 브랜치: ${branch}`)
  delete project.branches[branch]
  saveConfig(config)
  console.log(`${project.name} — ${branch} 를(을) 대응표에서 뺐다`)
}

function cmdRemove(positional) {
  const config = readConfigFile()
  const project = requireProject(config, positional[0])
  config.projects = config.projects.filter((p) => p.key !== project.key)
  saveConfig(config)
  useConfig(config)
  console.log(`${project.name} — 추적 목록에서 뺐다`)
  // 기준점과 복제본은 지우지 않는다 — 다시 등록하면 이어서 쓴다. 지울지는 사람이 정한다
  console.log(`복제본 · 기준점은 남겨 두었다 — ${path.join(MIRROR_DIR, `${project.repo}.git`)}`)
}

function cmdList() {
  console.log(`설정: ${CONFIG_PATH}`)
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log('  (없음 — node collect.mjs init)')
    return
  }
  const config = loadConfig()
  console.log(`기록 · 복제본 · 보고서: ${BASE_DIR}`)
  if (config.projects.length === 0) {
    console.log('등록된 프로젝트 없음 — node collect.mjs add --url <저장소 주소>')
    return
  }
  for (const p of config.projects) {
    const aliases = (p.aliases ?? []).length > 0 ? ` · 별칭 ${p.aliases.join(', ')}` : ''
    console.log(`- ${p.name} (key: ${p.key}${aliases})`)
    console.log(`    ${p.url}`)
    for (const [branch, m] of Object.entries(p.branches ?? {})) {
      console.log(`    ${branch} → ${m.platform}${m.prefix ? ` (머리말 「${m.prefix}」)` : ''}`)
    }
    if ((p.exclude ?? []).length > 0) console.log(`    제외: ${p.exclude.join(', ')}`)
  }
}

// ── 진입 ─────────────────────────────────────────────────

function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { flags, positional } = parseArgs(rest)
  const now = new Date()

  switch (command) {
    case 'init':
      return cmdInit(flags)
    case 'add':
      return cmdAdd(flags)
    case 'map':
      return cmdMap(positional, flags)
    case 'unmap':
      return cmdUnmap(positional)
    case 'remove':
      return cmdRemove(positional)
    case 'list':
      return cmdList()
    case 'commit': {
      loadConfig()
      const collectPath = positional[0]
      if (collectPath === undefined) throw new CollectError('수집 파일 경로가 필요하다')
      const names = commitState(collectPath)
      console.log(`기준점을 옮김: ${names.join(', ')}`)
      return
    }
    case 'report':
    case 'redo':
      break
    default:
      throw new CollectError('사용: node collect.mjs init | add | map | unmap | remove | list | report | redo | commit — 머리 주석 참고')
  }

  loadConfig()
  const projectFilter = typeof flags.project === 'string' ? flags.project : undefined
  const projects = selectProjects(projectFilter)
  const { state, isCorrupt } = loadState()
  const collected = command === 'report' ? collectReport(projects, state, isCorrupt, now) : collectRedo(projects, state, now)
  fs.mkdirSync(WORK_DIR, { recursive: true })
  const outPath = path.join(WORK_DIR, `collect-${command}-${stamp(now)}.json`)
  fs.writeFileSync(outPath, `${JSON.stringify(collected, null, 2)}\n`, 'utf8')
  const digestPath = outPath.replace(/\.json$/, '.md')
  fs.writeFileSync(digestPath, buildDigest(collected), 'utf8')
  printSummary(collected, outPath)
  console.log(`요약본: ${digestPath}`)
}

try {
  main()
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
