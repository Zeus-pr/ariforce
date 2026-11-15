/** Sentences for the organization and leave admin screens. */
export function adminMessage(code: string | undefined, fallback: string) {
  switch (code) {
    case 'FORBIDDEN':
      return 'You can’t change this.';
    case 'NOT_FOUND':
      return 'That record is no longer there. Reload the page.';
    case 'VERSION_CONFLICT':
      return 'Someone else changed this. Reload and try again.';
    case 'CODE_TAKEN':
      return 'That code is already used. Choose another.';
    case 'TERRITORY_KEY_TAKEN':
      return 'This BM HQ already has a territory with that name.';
    case 'NATIONAL_EXISTS':
      return 'The company already has a country.';
    case 'TERRITORY_PARENT_LEVEL':
      return fallback || 'That place cannot sit under the one you chose.';
    case 'TERRITORY_CYCLE':
      return 'A place cannot be moved under itself.';
    case 'TERRITORY_IN_USE':
      return 'This place is still in use. Move the people and records off it first.';
    case 'HOLIDAY_DATE_TAKEN':
      return 'That date already has a holiday.';
    case 'VALIDATION':
      return fallback || 'Check the value and try again.';
    case 'LEAVE_SELF_GRANT':
      return 'You can’t change your own leave from here.';
    case 'LEAVE_TYPE_UNKNOWN':
      return 'That leave type is not active.';
    default:
      return fallback || 'Something went wrong. Try again.';
  }
}
