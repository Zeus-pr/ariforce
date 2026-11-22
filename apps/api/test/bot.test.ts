import { describe, expect, it } from 'vitest';
import { askerRoleLabel, botAudience, knowledgeFor } from '../src/bot/knowledge';
import { guardNarrative, runBot, toolSpecs } from '../src/bot/run';

describe('ARIBOT access', () => {
  it('stops below Area Business Manager and opens the company only for a Director', () => {
    expect(botAudience(['business_manager'])).toBe('none');
    expect(botAudience(['hr'])).toBe('none');
    expect(botAudience(['system_admin'])).toBe('director');
    expect(botAudience(['distribution_head'])).toBe('director');
    expect(botAudience(['area_business_manager'])).toBe('team');
    expect(botAudience(['regional_business_manager'])).toBe('team');
    expect(botAudience(['director'])).toBe('director');
    expect(askerRoleLabel(['area_business_manager'])).toBe('Area Business Manager');
  });

  it('does not offer a company rollup below Director', () => {
    const names = (director: boolean) =>
      toolSpecs(director).find((tool) => tool.name === 'kpi_report')?.parameters;
    expect(JSON.stringify(names(false))).not.toContain('company');
    expect(JSON.stringify(names(true))).toContain('company');
  });

  it('gives a Director the company text and keeps it off everyone else', () => {
    expect(knowledgeFor('team')).not.toContain('Their line is the whole company');
    expect(knowledgeFor('director')).toContain('Their line is the whole company');
    expect(knowledgeFor('team')).toContain('manager chain');
  });
});

describe('ARIBOT answers', () => {
  it('keeps a number that a tool returned and drops one it invented', () => {
    expect(guardNarrative('Coverage is 81.2%.', '81.2', true)).toEqual({
      narrative: 'Coverage is 81.2%.',
      refused: false,
    });
    expect(guardNarrative('Coverage is 99%.', '81.2', true).narrative).toBe(
      'The figures are in the table.',
    );
    expect(guardNarrative('Coverage is 99%.', '', false).refused).toBe(true);
  });

  it('runs a tool, then answers from that table', async () => {
    let step = 0;
    const result = await runBot({
      knowledge: 'Coverage is a share of doctors.',
      scopeLine: 'Scope: their reporting line only.',
      message: 'What is my coverage?',
      specs: toolSpecs(false),
      call: async () => ({
        model: { rows: [['Me', 'Coverage', '81.2%']] },
        block: {
          type: 'table',
          title: 'KPIs',
          columns: ['Who', 'Measure', 'Value'],
          rows: [['Me', 'Coverage', '81.2%']],
        },
      }),
      complete: async () => {
        step += 1;
        if (step === 1)
          return {
            content: null,
            tool_calls: [{ id: 'call_1', function: { name: 'kpi_report', arguments: '{}' } }],
          };
        return { content: '{"narrative":"Coverage is 81.2%."}' };
      },
    });
    expect(result.toolNames).toEqual(['kpi_report']);
    expect(result.narrative).toBe('Coverage is 81.2%.');
    expect(result.blocks).toHaveLength(1);
    expect(result.refused).toBe(false);
  });
});
