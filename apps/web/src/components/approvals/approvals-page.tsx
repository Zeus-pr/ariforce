'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { ApprovalsInbox } from './approvals-inbox';
import { OrgApprovals } from './approvals-org';

/** Waiting for me = one list of requests, tour plan days, daily reports and sign-ups; Everyone = the org-wide view (PR #128). */
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
          <ApprovalsInbox />
        </TabsContent>
        <TabsContent value="org">
          <OrgApprovals />
        </TabsContent>
      </Tabs>
    </div>
  );
}
