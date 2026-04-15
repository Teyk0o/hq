/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

export interface LayoutProps {
  title?: string;
  project?: string;
  projects?: string[];
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title = 'HQ',
  project,
  projects = [],
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
      <script
        dangerouslySetInnerHTML={{
          __html: `
        // Project switcher: reload to the selected project, preserving the current path.
        function hqSwitchProject(name){
          const url = new URL(window.location.href);
          url.searchParams.set('project', name);
          window.location.href = url.toString();
        }
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
        <a href={`/board?project=${project ?? ''}`} class="font-bold text-lg">
          HQ
        </a>
        {projects.length > 1 && (
          <select
            class="bg-zinc-800 text-sm rounded px-2 py-1"
            onchange="hqSwitchProject(this.value)"
          >
            {projects.map((p) => (
              <option value={p} selected={p === project}>
                {p}
              </option>
            ))}
          </select>
        )}
        <nav class="flex gap-3 text-sm text-zinc-400">
          <a href={`/board?project=${project ?? ''}`} class="hover:text-white">Board</a>
          <a href={`/agents?project=${project ?? ''}`} class="hover:text-white">Agents</a>
          <a href={`/activity?project=${project ?? ''}`} class="hover:text-white">Activity</a>
        </nav>
        <div
          class="ml-auto flex items-center gap-2 text-xs"
          id="usage-widget"
          hx-get="/usage/widget"
          hx-trigger="load, sse:claude.usage_updated from:body"
          hx-swap="innerHTML"
        >
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
