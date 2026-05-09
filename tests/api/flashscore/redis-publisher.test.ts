import { describe, it, expect, beforeEach } from 'vitest'
import { shouldPublish, _resetThrottleForTests } from '@/app/api/flashscore/live/_redis-publisher'

describe('shouldPublish throttle', () => {
  beforeEach(() => { _resetThrottleForTests() })

  it('returns true for first call on a sofa_event_id', () => {
    expect(shouldPublish(125162771, Date.now())).toBe(true)
  })

  it('returns false for second call within 5s window', () => {
    const now = 1000
    shouldPublish(125162771, now)
    expect(shouldPublish(125162771, now + 4999)).toBe(false)
  })

  it('returns true for second call AFTER 5s window', () => {
    const now = 1000
    shouldPublish(125162771, now)
    expect(shouldPublish(125162771, now + 5001)).toBe(true)
  })

  it('different sofa_event_ids are independent', () => {
    const now = 1000
    shouldPublish(125162771, now)
    expect(shouldPublish(125162772, now)).toBe(true)
  })

  it('throttle resets after _resetThrottleForTests', () => {
    shouldPublish(125162771, 1000)
    _resetThrottleForTests()
    expect(shouldPublish(125162771, 1001)).toBe(true)
  })
})
