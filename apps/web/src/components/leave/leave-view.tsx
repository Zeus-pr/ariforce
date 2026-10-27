'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { useRole } from '@/components/shell/role-context';
import { selfId } from '@/lib/expenses/model';
import { canLeave, seesLeave, today } from '@/lib/leave/model';
import { LeaveGrantPanel, LeaveSettingsPanel } from './leave-admin';
import { LeaveApprovals } from './approvals';
import { LeaveCalendar } from './leave-calendar';
import { MyLeave } from './my-leave';
import { useLeave } from './use-leave';

export function LeaveView() {
  const { role, user } = useRole();
  const year = Number(today().slice(0, 4));
  const data = useLeave(year, role);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    void selfId(role, user).then(setMe);
  }, [role, user]);

  if (!seesLeave(role)) {
    return <p className="text-sm text-muted-foreground" data-testid="leave-no-access">Leave isn't part of your role.</p>;
  }
  const approver = canLeave(role, 'leave:approve');
  const admin = canLeave(role, 'settings:write');

  return (
    <Tabs defaultValue="mine" className="gap-4">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="mine" data-testid="tab-mine">My leave</TabsTrigger>
        {approver && <TabsTrigger value="approvals" data-testid="tab-approvals">Approvals</TabsTrigger>}
        <TabsTrigger value="calendar" data-testid="tab-calendar">Calendar</TabsTrigger>
        {(approver || admin) && <TabsTrigger value="admin" data-testid="tab-admin">{admin ? 'Settings' : 'Grants'}</TabsTrigger>}
      </TabsList>
      {data.error && (
        <p className="text-sm text-destructive" role="alert" data-testid="leave-error">
          {data.error}
        </p>
      )}
      <TabsContent value="mine">
        <MyLeave data={data} year={year} />
      </TabsContent>
      {approver && (
        <TabsContent value="approvals">
          <LeaveApprovals levels={data.settings?.approvalLevels ?? 2} onDecided={data.reload} />
        </TabsContent>
      )}
      <TabsContent value="calendar">
        <LeaveCalendar weeklyOff={data.settings?.weeklyOffDays ?? [0]} team={approver} />
      </TabsContent>
      {(approver || admin) && (
        <TabsContent value="admin" className="flex flex-col gap-6">
          {admin && data.settings && <LeaveSettingsPanel settings={data.settings} types={data.types} onSaved={data.reload} />}
          {approver && <LeaveGrantPanel types={data.types} selfId={me} />}
        </TabsContent>
      )}
    </Tabs>
  );
}
