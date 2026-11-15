import { CompanyMessageForm } from '@/components/notifications/company-message-form';

export const metadata = { title: 'Company message' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company message</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reaches every active person except you. It shows in their notification list and, once
          their phone is on this build, as a phone notification.
        </p>
      </div>
      <CompanyMessageForm />
    </div>
  );
}
