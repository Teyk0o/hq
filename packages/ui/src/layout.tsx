/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

export interface LayoutProps {
  title?: string;
  project?: string;
  projects?: string[];
  page?: 'board' | 'agents' | 'activity';
}

/**
 * Notion-inspired layout: cream background, fixed sidebar with project+nav,
 * generous whitespace, subtle typography. Everything is server-rendered JSX;
 * HTMX + SSE drive updates without a client build.
 */
export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title = 'HQ',
  project,
  projects = [],
  page = 'board',
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>{title}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          :root {
            --notion-bg: #FBFBFA;
            --notion-sidebar: #F7F6F3;
            --notion-text: #37352F;
            --notion-text-muted: #787874;
            --notion-text-faint: #9B9A97;
            --notion-border: #EBEBE9;
            --notion-hover: #EFEFED;
            --notion-active: #E8E7E4;
            --accent-blue: #2383E2;
            --accent-red: #E03E3E;
            --accent-green: #0F7B6C;
            --accent-yellow: #D9730D;
            --accent-purple: #9065B0;
          }
          html, body { background: var(--notion-bg); color: var(--notion-text); font-family: 'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif; font-feature-settings: 'ss01', 'cv11'; -webkit-font-smoothing: antialiased; }
          .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
          .hover-bg:hover { background: var(--notion-hover); }
          .active-bg { background: var(--notion-active); }
          .border-soft { border-color: var(--notion-border); }
          .text-muted { color: var(--notion-text-muted); }
          .text-faint { color: var(--notion-text-faint); }
          /* Subtle fade-in for SSE-swapped content */
          .swap-in { animation: swapIn 200ms ease-out; }
          @keyframes swapIn { from { opacity: 0.6; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
          /* Drawer slide */
          .drawer { animation: slideIn 180ms ease-out; }
          @keyframes slideIn { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
          /* Toasts */
          #toasts { position: fixed; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 50; pointer-events: none; }
          .toast { pointer-events: auto; background: white; border: 1px solid var(--notion-border); box-shadow: 0 4px 16px rgba(15,15,15,0.08); padding: 10px 14px; border-radius: 8px; min-width: 240px; font-size: 13px; animation: toastIn 180ms ease-out; }
          @keyframes toastIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          /* Scrollbars */
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #D3D2CE; border-radius: 5px; border: 2px solid var(--notion-bg); }
          ::-webkit-scrollbar-thumb:hover { background: #B9B8B4; }
          /* Pulse dot */
          .pulse-dot { position: relative; }
          .pulse-dot::before { content: ''; position: absolute; inset: -3px; border-radius: 9999px; background: inherit; opacity: 0.4; animation: pulse 1.6s ease-out infinite; }
          @keyframes pulse { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(1.8); opacity: 0; } }
        `,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
          function hqSwitchProject(name){
            const url = new URL(window.location.href);
            url.searchParams.set('project', name);
            window.location.href = url.toString();
          }
          // Lightweight toast feed from SSE events
          function hqInit(){
            const evs = ['task.claimed','task.status_changed','task.reviewed','task.blocked','agent.heartbeat_started','agent.heartbeat_ended'];
            const src = new EventSource('/events' + window.location.search);
            const container = document.getElementById('toasts');
            const icons = {
              'task.claimed': '👋', 'task.status_changed': '↪', 'task.reviewed': '✓',
              'task.blocked': '⚠', 'agent.heartbeat_started': '▶', 'agent.heartbeat_ended': '⏹'
            };
            evs.forEach(ev => src.addEventListener(ev, (e) => {
              try {
                const d = JSON.parse(e.data);
                const t = document.createElement('div');
                t.className = 'toast';
                const agent = d.agent || d.by || d.reviewer || '';
                const sub = d.task_id ? ' · ' + d.task_id.slice(0,6) : '';
                t.innerHTML = '<span style="margin-right:8px">' + (icons[ev]||'•') + '</span><strong>' + ev.replace(/\\./g,' ') + '</strong> <span style="color:var(--notion-text-muted)">' + agent + sub + '</span>';
                container.appendChild(t);
                setTimeout(() => { t.style.transition = 'opacity 300ms'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4500);
              } catch (err) {}
            }));
          }
          document.addEventListener('DOMContentLoaded', hqInit);
        `,
        }}
      />
    </head>
    <body
      class="min-h-screen"
      hx-ext="sse"
      sse-connect={`/events${project ? `?project=${project}` : ''}`}
    >
      <div class="flex min-h-screen">
        {/* Sidebar */}
        <aside
          class="w-[260px] shrink-0 border-r border-soft"
          style="background: var(--notion-sidebar)"
        >
          <div class="p-3">
            <div class="flex items-center gap-2 px-2 py-1.5">
              <div class="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-bold" style="background: var(--accent-blue)">H</div>
              <span class="font-semibold text-[14px]">HQ</span>
            </div>
            {projects.length > 0 && (
              <div class="mt-3">
                <label class="text-[11px] uppercase tracking-wider text-faint px-2">Project</label>
                <select
                  class="w-full mt-1 px-2 py-1.5 text-[13px] rounded-md border border-soft bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  onchange="hqSwitchProject(this.value)"
                >
                  {projects.map((p) => (
                    <option value={p} selected={p === project}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <nav class="mt-4 flex flex-col gap-0.5">
              <NavItem href={`/board?project=${project ?? ''}`} active={page === 'board'} icon="▦" label="Board" />
              <NavItem href={`/agents?project=${project ?? ''}`} active={page === 'agents'} icon="◉" label="Agents" />
              <NavItem href={`/activity?project=${project ?? ''}`} active={page === 'activity'} icon="≡" label="Activity" />
            </nav>
          </div>

          <div class="mt-4 px-3">
            <div class="text-[11px] uppercase tracking-wider text-faint px-2 mb-1">Agents</div>
            <div
              id="sidebar-agents"
              hx-get={`/agents/sidebar?project=${project ?? ''}`}
              hx-trigger="load, sse:agent.status_changed from:body, sse:agent.heartbeat_started from:body, sse:agent.heartbeat_ended from:body"
              hx-swap="innerHTML"
            >
              <div class="text-[12px] text-faint px-2 py-1">Loading…</div>
            </div>
          </div>

          <div class="absolute bottom-4 left-4 right-4 w-[228px]">
            <button
              hx-post="/api/daemon/pause"
              hx-swap="none"
              class="w-full text-[12px] px-3 py-1.5 rounded-md border border-soft hover-bg text-muted flex items-center justify-center gap-2"
            >
              <span style="color: var(--accent-red)">⏸</span> Pause all agents
            </button>
          </div>
        </aside>

        {/* Main */}
        <main class="flex-1 min-w-0">
          <header class="border-b border-soft px-8 py-4 flex items-center justify-between" style="background: var(--notion-bg)">
            <div>
              <h1 class="text-[22px] font-semibold leading-tight">{title}</h1>
              {project && <p class="text-[12px] text-faint mt-0.5 mono">{project}</p>}
            </div>
            <div
              id="usage-widget"
              class="flex items-center gap-2"
              hx-get="/usage/widget"
              hx-trigger="load, sse:claude.usage_updated from:body"
              hx-swap="innerHTML"
            >
              <span class="text-[12px] text-faint">loading usage…</span>
            </div>
          </header>
          <div class="px-8 py-6">{children}</div>
        </main>
      </div>

      <div id="toasts"></div>
    </body>
  </html>
);

const NavItem: FC<{ href: string; active: boolean; icon: string; label: string }> = ({
  href,
  active,
  icon,
  label,
}) => (
  <a
    href={href}
    class={
      'flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] ' +
      (active ? 'active-bg font-medium' : 'hover-bg text-muted')
    }
  >
    <span class="w-4 text-center opacity-70">{icon}</span>
    <span>{label}</span>
  </a>
);
