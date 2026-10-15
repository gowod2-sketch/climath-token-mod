import { pctOf } from '../hooks/register'
import { test, expect } from 'claude-code/testing'
test('get_session 결과에서 % 를 뽑는다', () => {
  const r = pctOf(JSON.stringify({ ccr: { session_status: 'SESSION_STATUS_IDLE', external_metadata: { context_usage: { used_tokens: 373109, max_tokens: 500000 } } } }))
  expect(r.pct).toBe(74.6)
  expect(r.state).toBe('idle')
})
test('깨진 글은 null', () => {
  expect(pctOf('nope').pct).toBe(null)
})
import { sky, bar } from '../hooks/register'
test('날씨 기호와 막대', () => {
  expect(sky(75)).toBe('🌧'); expect(sky(60)).toBe('⛅'); expect(sky(20)).toBe('☀')
  expect(bar(50, 8)).toBe('████░░░░')
})
