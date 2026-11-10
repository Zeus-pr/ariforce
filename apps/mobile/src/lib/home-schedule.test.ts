/// <reference types="jest" />
import type { PlannedDoctors } from '@ariforce/contracts';
import { scheduleFromPlan } from '@/lib/home-schedule';

const item = (over: Partial<PlannedDoctors['items'][number]>): PlannedDoctors['items'][number] => ({
  doctorId: '01930000-0000-7000-8000-000000000001',
  name: 'Dr. Roy',
  specialtyId: null,
  categoryId: null,
  territoryId: '01930000-0000-7000-8000-000000000002',
  source: 'tour_plan',
  visited: false,
  lastCallDate: null,
  ...over,
});

describe('scheduleFromPlan', () => {
  it('keeps planned visits and marks who was actually called', () => {
    expect(
      scheduleFromPlan([
        item({ name: 'Dr. Roy', visited: true }),
        item({
          doctorId: '01930000-0000-7000-8000-000000000003',
          name: 'Dr. Sen',
          source: 'tp_item_territory',
        }),
      ]),
    ).toEqual([
      {
        id: '01930000-0000-7000-8000-000000000001',
        name: 'Dr. Roy',
        detail: 'Called today',
        visited: true,
      },
    ]);
  });

  it('is empty when the tour plan has no doctors today', () => {
    expect(scheduleFromPlan([])).toEqual([]);
  });
});
