const STATS = [
  { label: "Reps checked in today", hint: "Attendance syncs from the field app" },
  { label: "Doctor calls logged", hint: "Daily call reports appear here" },
  { label: "Tour plans awaiting approval", hint: "Submitted plans for this month" },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="text-sm font-medium text-brand-teal-deep">Monday overview</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">Good evening, Prajesh</h1>
      <p className="mt-2 max-w-xl text-zinc-600">
        Nothing to review yet. Once your team starts logging calls and attendance, today&apos;s numbers show up here.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-5">
            <p className="text-sm text-zinc-600">{s.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-300">0</p>
            <p className="mt-3 text-xs text-zinc-500">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col items-start gap-3 rounded-xl border border-dashed border-zinc-300 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-zinc-900">Set up your masters</p>
          <p className="text-sm text-zinc-600">Add territories, doctors and chemists so reps can start reporting.</p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white transition-transform active:scale-[0.97]"
        >
          Add masters
        </button>
      </div>
    </div>
  );
}
