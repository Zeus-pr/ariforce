/** A suspended or left person does not hold the seat. The box stays, under the name Vacant. */
export function seatIsVacant(person: { status?: string | null; hrStatus?: string | null }) {
  if (person.status === 'suspended') return true;
  const hr = (person.hrStatus ?? '').trim().toLowerCase();
  return hr === 'left' || hr === 'inactive' || hr === 'suspended';
}
