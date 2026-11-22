import { describe, expect, it } from 'vitest';
import { BOT_QUESTIONS, readyQuestions } from '../src/bot/questions';
import { toolSpecs } from '../src/bot/run';

describe('ARIBOT question set', () => {
  it('covers thirty to fifty questions, each with one job', () => {
    expect(BOT_QUESTIONS.length).toBeGreaterThanOrEqual(30);
    expect(BOT_QUESTIONS.length).toBeLessThanOrEqual(50);
    expect(new Set(BOT_QUESTIONS.map((q) => q.id)).size).toBe(BOT_QUESTIONS.length);
    for (const q of BOT_QUESTIONS) {
      expect(q.ask.trim().endsWith('?')).toBe(true);
      if (q.kind === 'tool') expect(q.tool).toBeTruthy();
      if (q.kind !== 'tool') expect(q.tool).toBeUndefined();
      if (q.show) expect(q.kind).toBe('tool');
    }
  });

  it('keeps company questions off the team list and on the Director list', () => {
    const team = readyQuestions(false).map((q) => q.ask);
    const director = readyQuestions(true).map((q) => q.ask);
    expect(team.some((ask) => /company/i.test(ask))).toBe(false);
    expect(director.some((ask) => /company coverage/i.test(ask))).toBe(true);
    for (const q of BOT_QUESTIONS) {
      if (q.who === 'team' && q.kind === 'refuse') expect(q.show).toBeFalsy();
    }
  });

  it('only names tools the signed-in person is actually offered', () => {
    const offered = new Set(toolSpecs(false).map((tool) => tool.name));
    for (const q of BOT_QUESTIONS) {
      if (q.who === 'team' && q.tool) expect(offered.has(q.tool)).toBe(true);
    }
    expect(offered.has('list_team')).toBe(true);
    expect(offered.has('kpi_report')).toBe(true);
    expect(offered.has('product_kpis')).toBe(true);
  });
});
