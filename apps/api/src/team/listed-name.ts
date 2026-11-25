/** How a person who no longer holds a seat is shown in lists. The stored name is unchanged. */
export function listedName(name: string, status: string, hrStatus: string | null): string {
  const hr = (hrStatus ?? '').trim().toLowerCase();
  const mark =
    hr === 'left'
      ? 'left'
      : hr === 'inactive'
        ? 'inactive'
        : hr === 'suspended' || status === 'suspended'
          ? 'suspended'
          : null;
  return mark ? `${name} (${mark})` : name;
}
