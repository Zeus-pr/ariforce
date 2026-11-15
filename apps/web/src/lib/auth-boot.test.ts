import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bootTarget } from './auth-boot.ts';

describe('bootTarget', () => {
  it('sends a visitor with no stored profile to sign-in and keeps the path', () => {
    assert.equal(bootTarget('/audit', '', false), '/sign-in?next=%2Faudit');
    assert.equal(bootTarget('/', '', false), '/sign-in');
  });

  it('does not use a stored role to allow or block a page', () => {
    assert.equal(bootTarget('/admin/people', '', true), null);
    assert.equal(bootTarget('/audit', '?x=1', true), null);
  });

  it('leaves public pages and the sign-in page alone', () => {
    assert.equal(bootTarget('/sign-up', '', false), null);
    assert.equal(bootTarget('/invite', '', false), null);
    assert.equal(bootTarget('/forgot-password', '', false), null);
    assert.equal(bootTarget('/sign-in', '', true), null);
  });
});
