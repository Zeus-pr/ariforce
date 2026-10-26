'use client';

// Last-resort boundary (root layout failed). Plain HTML so it renders even if styles did not load.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p>AriForce could not load this page.</p>
        <button type="button" onClick={() => reset()} style={{ marginRight: 12 }}>
          Try again
        </button>
        <a href="/sign-in">Go to sign in</a>
      </body>
    </html>
  );
}
