import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'
import type { Row, Usage } from '../types'

// 세션 사용량 창 (마스터 10-13 「세션 사용량 띄우기」). PM 세션을 get_session 으로 직접 잰다 — 모델 토큰을 쓰지 않는다.
const PANE = 'pm-usage'
const SERVERS = ['Claude_Code_Remote', 'claude-code-remote', 'Claude Code Remote', 'claude_code_remote']
let server: string | null = null
const errs: string[] = []
let PMS: [string, string][] = []
// 설정 칸 sessions: "TS=session_...,CL=session_..." (공개 저장소라 세션 주소는 코드에 넣지 않는다)
export function parsePms(text: unknown): [string, string][] {
  return String(text ?? '').split(/[,\s]+/).map(x => x.split('=')).filter(a => a.length === 2 && a[0] && a[1]).map(a => [a[0], a[1]] as [string, string])
}
const usage = atom({ plugin: 'pm-usage', key: 'usage' } as const, null)
const hidden = atom({ plugin: 'pm-usage', key: 'hidden' } as const, false)

export function pctOf(text: string): { pct: number | null; state: string } {
  try {
    const j = JSON.parse(text)
    const s = j.ccr ?? j
    const cu = s.external_metadata?.context_usage
    const pct = cu && cu.max_tokens ? Math.round((cu.used_tokens / cu.max_tokens) * 1000) / 10 : null
    const state = String(s.session_status ?? '').replace('SESSION_STATUS_', '').toLowerCase()
    return { pct, state }
  } catch {
    return { pct: null, state: '읽기 실패' }
  }
}

async function call($: EngineInterface, id: string) {
  const names = server ? [server] : SERVERS
  let lastErr: unknown = null
  for (const name of names) {
    try {
      const r = await Promise.race([
        $.mcp.call(name, 'get_session', { session_id: id }),
        $.clock.sleep(20000).then(() => { throw new Error('20초 넘음') }),
      ])
      server = name
      return r
    } catch (err) {
      lastErr = err
      if (errs.length < 8) errs.push(`${name}: ${String(err).slice(0, 120)}`)
    }
  }
  throw lastErr
}

async function one($: EngineInterface, pm: string, id: string): Promise<Row> {
  try {
    const r = await call($, id)
    const block = r.content.find(c => c.type === 'text') as { text?: string } | undefined
    const raw = block?.text ?? ''
    if (r.isError) return { pm, pct: null, state: `오류: ${raw.slice(0, 40)}` }
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    return { pm, ...pctOf(json) }
  } catch (err) {
    return { pm, pct: null, state: `못 잼: ${String(err).slice(0, 40)}` }
  }
}


async function measure($: EngineInterface): Promise<Usage> {
  const at = new Date().toISOString()
  const rows = await Promise.all(PMS.map(([pm, id]) => one($, pm, id)))
  rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
  if (rows.some(r => r.pct != null)) return { at, rows, error: null }
  return { at, rows, error: null }
}

export function listText(u: Usage): string {
  return u.rows.map(r => `${r.pm} ${r.pct == null ? '—' : r.pct + '%'}${r.pct == null ? ` (${r.state})` : ''}`).join(' · ')
}

let last: Usage | null = null

async function mine($: EngineInterface) {
  const u = await $.session.usage()
  const ctx = u.context.percent == null ? '?' : `${Math.round(u.context.percent)}%`
  const five = u.rateLimits.find(r => r.kind.includes('five'))
  const top = last ? last.rows.filter(r => r.pct != null).slice(0, 5).map(r => `${r.pm} ${Math.round(r.pct as number)}`).join(' · ') : '재는 중'
  $.ui.status(`MC ${ctx}${five ? ` · 5시간 ${Math.round(five.percentUsed)}%` : ''} ┃ ${top}`)
}

async function refresh($: EngineInterface) {
  const u = await measure($)
  last = u
  await update($, usage, () => u)
  await mine($)
  return u
}

export const sky = (p: number | null) => (p == null ? '·' : p >= 70 ? '🌧' : p >= 50 ? '⛅' : '☀')
export const bar = (p: number | null, w = 10) => {
  if (p == null) return '░'.repeat(w)
  const n = Math.max(0, Math.min(w, Math.round((p / 100) * w)))
  return '█'.repeat(n) + '░'.repeat(w - n)
}
const mark = (p: number | null) => (p == null ? '·' : p >= 70 ? '■' : p >= 50 ? '▣' : '□')

export const register: Register = (on, options) => {
  PMS = parsePms((options as { sessions?: string } | undefined)?.sessions)
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pm-usage', description: 'PM 16곳 사용량 — 창 열기·지금 다시 재기' })
    void mine($)
    $.clock.every(60 * 1000, () => void mine($))
    void refresh($)
    $.clock.every(10 * 60 * 1000, () => void refresh($))
    // 창은 자동으로 열지 않는다 — 사용량은 「나만의 대시보드」 오른쪽 끝에 합침(마스터 10-13). /pm-usage 로만 연다.
    return next(e)
  })

  on('command.run', { command: 'pm-usage' }, async $ => {
    await update($, hidden, () => false)
    const u = await refresh($)
    await $.ui.open({ id: PANE, title: '세션 사용량', columns: 34, rows: 60 })
    const hot = u.rows.filter(r => (r.pct ?? 0) >= 70).length
    return { text: `PM 사용량(${u.at.slice(11, 16)}Z) — 70% 넘음 ${hot}곳\n${listText(u)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const u = await read($, usage)
    if (!u) return <Text dimColor>재는 중…</Text>
    return (
      <Box flexDirection="column">
        <Text bold>{`PM ${u.rows.length}곳 · 70%↑ ${u.rows.filter(r => (r.pct ?? 0) >= 70).length}`}</Text>
        {u.rows.map(r => (
          <Text color={(r.pct ?? 0) >= 70 ? 'red' : (r.pct ?? 0) >= 50 ? 'yellow' : undefined}>
            {`${mark(r.pct)} ${r.pm.padEnd(3)} ${r.pct == null ? '  —' : String(r.pct).padStart(5)}%  ${r.state}`}
          </Text>
        ))}
        <Text dimColor>{`${u.at.slice(11, 16)}Z 기준 · 10분마다 · /pm-usage`}</Text>
      </Box>
    )
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const u = await read($, usage)
    if (!u || e.props.hasSurvey || (await read($, hidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const rain = u.rows.filter(r => (r.pct ?? 0) >= 70).length
    const cloud = u.rows.filter(r => (r.pct ?? 0) >= 50 && (r.pct ?? 0) < 70).length
    const sun = u.rows.filter(r => r.pct != null && r.pct < 50).length
    const kst = new Date(Date.parse(u.at) + 9 * 3600 * 1000).toISOString().slice(11, 16)
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold size="heading">{`PM 토큰 날씨 ${kst}  ☀${sun} ⛅${cloud} 🌧${rain}  `}</Text>
          <Button key="hide" label="접기" onPress={() => update($, hidden, () => true)} />
        </Box>
        <Box flexWrap="wrap">
          {u.rows.map(r => (
            <Box key={r.pm} width={28}>
              <Text size="heading" color={(r.pct ?? 0) >= 70 ? 'red' : (r.pct ?? 0) >= 50 ? 'yellow' : 'green'}>
                {`${sky(r.pct)}${r.pm.padEnd(3)}${bar(r.pct, 8)}${r.pct == null ? ' —' : String(Math.round(r.pct)).padStart(3)}`}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
