import { describe, expect, test } from 'claude-code/testing'
import { laterWords } from '../hooks/owner-cards'
import { JERUSALEM } from './fixtures'

describe('laterWords', () => {
  test('a bare day reads as its weekday and date, whatever the zone', () => {
    expect(laterWords('2026-11-02', JERUSALEM)).toBe('Mon 11-02')
  })

  test('a minute is UTC as stored and reads on the zone’s clock', () => {
    expect(laterWords('2026-11-02 10:00', JERUSALEM)).toBe('11-02 12:00 IST')
  })
})
