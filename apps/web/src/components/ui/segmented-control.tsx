'use client';

import { cn } from '@ariforce/ui/lib/utils';
import {
  Tabs,
  TabsHighlight,
  TabsHighlightItem,
  TabsList,
  TabsTrigger,
} from '@animate-ui/react/primitives/tabs';

/** Sliding period switch. The thumb is Animate UI's highlight, the same motion as the 21st.dev segmented control. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as T)}>
      <TabsHighlight className="inset-0 rounded-full bg-cyan-400">
        <TabsList
          className="relative inline-flex rounded-full bg-neutral-950 p-1"
          aria-label={label}
        >
          {options.map((option) => (
            <TabsHighlightItem key={option.value} value={option.value}>
              <TabsTrigger
                value={option.value}
                className={cn(
                  'relative z-10 rounded-full px-3 py-1.5 text-sm font-medium text-neutral-300',
                  'data-[state=active]:text-neutral-950',
                )}
              >
                {option.label}
              </TabsTrigger>
            </TabsHighlightItem>
          ))}
        </TabsList>
      </TabsHighlight>
    </Tabs>
  );
}
