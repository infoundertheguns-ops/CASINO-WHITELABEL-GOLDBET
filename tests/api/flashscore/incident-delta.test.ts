import { describe, it, expect } from 'vitest'
import { findNewIncidentIds } from '@/app/api/flashscore/live/_lib'

describe('findNewIncidentIds', () => {
  it('returns empty when both sides empty', () => {
    expect(findNewIncidentIds([], [])).toEqual([])
  })

  it('returns all new ids when prior is empty', () => {
    expect(findNewIncidentIds([], [{id: 'a'}, {id: 'b'}])).toEqual(['a', 'b'])
  })

  it('returns only new ids when some overlap', () => {
    const prior = [{id: 'a'}, {id: 'b'}]
    const next = [{id: 'a'}, {id: 'b'}, {id: 'c'}]
    expect(findNewIncidentIds(prior, next)).toEqual(['c'])
  })

  it('returns empty when no new ids (next subset of prior)', () => {
    const prior = [{id: 'a'}, {id: 'b'}]
    const next = [{id: 'a'}]
    expect(findNewIncidentIds(prior, next)).toEqual([])
  })

  it('handles missing/null incident arrays gracefully', () => {
    expect(findNewIncidentIds(null, null)).toEqual([])
    expect(findNewIncidentIds(undefined, [{id: 'a'}])).toEqual(['a'])
    expect(findNewIncidentIds([{id: 'a'}], null)).toEqual([])
  })

  it('skips entries without valid id', () => {
    const next = [{id: 'a'}, {label: 'noisy'}, {id: ''}, {id: null}]
    expect(findNewIncidentIds([], next as any)).toEqual(['a'])
  })
})
