/// <reference types="jest" />
import { canOpenFeature, featureHref } from '@/lib/features';

describe('company message access', () => {
  it('is only for a director or system admin', () => {
    expect(canOpenFeature('companyMessage', ['director'])).toBe(true);
    expect(canOpenFeature('companyMessage', ['system_admin'])).toBe(true);
    expect(canOpenFeature('companyMessage', ['business_manager'])).toBe(false);
    expect(canOpenFeature('companyMessage', ['area_business_manager'])).toBe(false);
  });

  it('opens the company message screen', () => {
    expect(featureHref('companyMessage')).toBe('/company-message');
  });
});
