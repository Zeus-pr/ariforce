'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { ApprovalsQueue } from './approvals-queue';
import { OrgApprovals } from './approvals-org';

/** Waiting for me = the dashboard queue; Everyone = the org-wide view (PR #128). */
export function ApprovalsPage() {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
      <Tabs defaultValue="mine" className="min-w-0 gap-4">
        <TabsList>
          <TabsTrigger value="mine">Waiting for me</TabsTrigger>
          <TabsTrigger value="org">Everyone</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          <ApprovalsQueue bare />
        </TabsContent>
        <TabsContent value="org">
          <OrgApprovals />
        </TabsContent>
      </Tabs>
    </div>
  );
}
