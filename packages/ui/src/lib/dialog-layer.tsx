'use client';

import * as React from 'react';

/** A menu portaled to document.body sits behind a native dialog. Keep it in that dialog. */
export function useDialogContainer() {
  const marker = React.useRef<HTMLSpanElement>(null);
  const [container, setContainer] = React.useState<HTMLElement | undefined>();
  React.useLayoutEffect(() => {
    const dialog = marker.current?.closest('dialog');
    if (dialog instanceof HTMLElement) setContainer(dialog);
  }, []);
  return { marker, container };
}
