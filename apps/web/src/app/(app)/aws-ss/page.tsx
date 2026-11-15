import { AwsSsScreen } from '@/components/stock-statements/aws-ss-screen';

export const metadata = { title: 'AWS & SS' };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-5 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">AWS & SS</h1>
      <AwsSsScreen />
    </div>
  );
}
