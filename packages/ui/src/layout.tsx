/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

export const Layout: FC<PropsWithChildren<{ title?: string; project?: string }>> = ({
  title = 'HQ',
  project,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        [x-cloak]{display:none!important}
        @view-transition{navigation:auto}
        .task-card{view-transition-name:var(--tn)}
        body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
      `,
        }}
      />
    </head>
    <body
      class="bg-zinc-950 text-zinc-100 min-h-screen"
      hx-ext="sse"
      sse-connect={`/events${project ? `?project=${project}` : ''}`}
    >
      <header class="border-b border-zinc-800 px-4 py-2 flex items-center gap-4">
        <a href="/" class="font-bold text-lg">
          HQ
        </a>
        <nav class="flex gap-3 text-sm text-zinc-400">
          <a href="/board" class="hover:text-white">Board</a>
          <a href="/agents" class="hover:text-white">Agents</a>
          <a href="/activity" class="hover:text-white">Activity</a>
        </nav>
        <div class="ml-auto flex items-center gap-4 text-xs" id="usage-widget" sse-swap="claude.usage_updated">
          <span class="text-zinc-500">usage loading…</span>
        </div>
        <button
          hx-post="/api/daemon/pause"
          hx-swap="none"
          class="ml-2 px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded text-white"
        >
          Pause all
        </button>
      </header>
      <main>{children}</main>
    </body>
  </html>
);
