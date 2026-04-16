/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

export interface LayoutProps {
  title?: string;
  project?: string;
  projects?: string[];
  page?: 'board' | 'agents' | 'activity' | 'inbox';
}

/**
 * Anthropic-inspired layout: warm cream surface, coral accent, ample
 * whitespace, rounded everywhere, soft shadows. Lucide icons loaded via CDN
 * and re-hydrated after every HTMX swap.
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
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:wght@500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/lucide@latest"></script>
      <script src="https://unpkg.com/htmx.org@2.0.3"></script>
      <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          :root {
            --bg: #F5F4EE;
            --surface: #FFFEFA;
            --surface-alt: #FAF8F2;
            --border: #E9E4D6;
            --border-strong: #D5CEB8;
            --ink: #1F1E1A;
            --ink-muted: #6E6A5B;
            --ink-faint: #9E9887;
            --accent: #CC785C;
            --accent-hover: #B76A50;
            --accent-soft: #F3E1D7;
            --success: #4B7F67;
            --success-soft: #DFEBE3;
            --warn: #C98A3F;
            --warn-soft: #F5E8D1;
            --danger: #B84747;
            --danger-soft: #F2D9D5;
            --violet: #7A6FB0;
            --teal: #4E8994;
          }
          html, body {
            background: var(--bg);
            color: var(--ink);
            font-family: 'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif;
            font-feature-settings: 'ss01','cv11';
            -webkit-font-smoothing: antialiased;
          }
          h1, h2, .serif { font-family: 'Fraunces', Georgia, serif; letter-spacing: -0.01em; }
          .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
          .text-muted { color: var(--ink-muted); }
          .text-faint { color: var(--ink-faint); }
          .border-soft { border-color: var(--border); }
          .surface { background: var(--surface); }
          .surface-alt { background: var(--surface-alt); }
          .hover-bg:hover { background: var(--surface-alt); }

          /* Shapes: Anthropic vibe is generous rounded corners */
          .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 14px;
            box-shadow: 0 1px 0 rgba(31,30,26,0.02);
          }
          .card:hover { box-shadow: 0 4px 20px rgba(31,30,26,0.06); }
          .btn {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 500;
            border: 1px solid var(--border); background: var(--surface);
            transition: background 120ms, border-color 120ms;
          }
          .btn:hover { background: var(--surface-alt); }
          .btn-primary {
            background: var(--accent); color: #fff; border-color: var(--accent);
          }
          .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
          .btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
          .btn-success { background: var(--success); color: #fff; border-color: var(--success); }
          .pill {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 500;
            border: 1px solid var(--border);
          }
          .pill-active { background: var(--accent); color: #fff; border-color: var(--accent); }
          .field {
            width: 100%; padding: 9px 12px; border-radius: 10px;
            border: 1px solid var(--border); background: var(--surface);
            font-size: 13px; color: var(--ink); outline: none;
            transition: border-color 120ms;
          }
          .field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
          textarea.field { resize: vertical; min-height: 68px; }

          /* Animations */
          .swap-in { animation: swapIn 200ms ease-out; }
          @keyframes swapIn { from { opacity: 0.6; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
          .drawer { animation: slideIn 180ms ease-out; }
          @keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

          /* Toasts */
          #toasts { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 50; pointer-events: none; }
          .toast {
            pointer-events: auto; background: var(--surface);
            border: 1px solid var(--border); border-radius: 12px;
            box-shadow: 0 8px 28px rgba(31,30,26,0.08);
            padding: 12px 16px; min-width: 260px; font-size: 13px;
            animation: toastIn 180ms ease-out;
            display: flex; align-items: center; gap: 10px;
          }
          @keyframes toastIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

          /* Scrollbar */
          ::-webkit-scrollbar { width: 10px; height: 10px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 5px; border: 2px solid var(--bg); }

          /* Pulse (for working agents) */
          .pulse-dot { position: relative; }
          .pulse-dot::before { content: ''; position: absolute; inset: -3px; border-radius: 9999px; background: inherit; opacity: 0.35; animation: pulse 1.6s ease-out infinite; }
          @keyframes pulse { 0% { transform: scale(1); opacity: 0.35; } 100% { transform: scale(2); opacity: 0; } }

          /* Lucide icon sizing defaults */
          [data-lucide] { width: 16px; height: 16px; stroke-width: 2; }
          .icon-sm [data-lucide], [data-lucide].icon-sm { width: 14px; height: 14px; }
          .icon-lg [data-lucide], [data-lucide].icon-lg { width: 20px; height: 20px; }
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
          function hqShowToast(html, tone){
            const c = document.getElementById('toasts');
            if (!c) return;
            const t = document.createElement('div');
            t.className = 'toast';
            if (tone === 'error') t.style.borderColor = 'var(--danger)';
            if (tone === 'success') t.style.borderColor = 'var(--success)';
            t.innerHTML = html;
            c.appendChild(t);
            if (window.lucide) window.lucide.createIcons({ root: t });
            setTimeout(() => { t.style.transition = 'opacity 300ms'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4500);
          }
          function hqInit(){
            if (window.lucide) window.lucide.createIcons();
            const evs = ['task.claimed','task.status_changed','task.reviewed','task.blocked','agent.heartbeat_started','agent.heartbeat_ended','message.sent','task.created'];
            const src = new EventSource('/events' + window.location.search);
            const icon = {
              'task.claimed':'hand', 'task.status_changed':'arrow-right', 'task.reviewed':'check',
              'task.blocked':'alert-triangle', 'agent.heartbeat_started':'play', 'agent.heartbeat_ended':'square',
              'message.sent':'mail', 'task.created':'plus'
            };
            evs.forEach(ev => src.addEventListener(ev, (e) => {
              try {
                const d = JSON.parse(e.data);
                const who = d.agent || d.by || d.reviewer || d.from || '';
                const sub = d.task_id ? ' · ' + d.task_id.slice(0,6) : '';
                const html = '<i data-lucide="'+(icon[ev]||'dot')+'" style="color:var(--accent)"></i><div><div style="font-weight:500">' + ev.replace(/\\./g,' ') + '</div><div style="color:var(--ink-muted);font-size:11px">' + who + sub + '</div></div>';
                hqShowToast(html, 'info');
              } catch (err) {}
            }));
          }
          document.addEventListener('htmx:responseError', (e) => {
            const detail = e.detail || {};
            const status = detail.xhr ? detail.xhr.status : '?';
            const body = detail.xhr ? (detail.xhr.responseText||'').slice(0,200) : '';
            hqShowToast('<i data-lucide="alert-octagon" style="color:var(--danger)"></i><div><div style="font-weight:500">Request failed ('+status+')</div><div style="color:var(--ink-muted);font-size:11px">'+body+'</div></div>', 'error');
          });
          document.addEventListener('htmx:sendError', () => {
            hqShowToast('<i data-lucide="wifi-off" style="color:var(--danger)"></i><div style="font-weight:500">Network error</div>', 'error');
          });
          document.addEventListener('htmx:afterSwap', () => { if (window.lucide) window.lucide.createIcons(); });
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
        <aside class="w-[260px] shrink-0 border-r border-soft" style="background: var(--surface-alt)">
          <div class="p-4">
            <div class="flex items-center gap-2.5 px-1">
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                style="background: var(--accent)"
              >
                <i data-lucide="sparkles"></i>
              </div>
              <span class="font-semibold text-[15px] serif">HQ</span>
            </div>
            {projects.length > 0 && (
              <div class="mt-5">
                <label class="text-[11px] uppercase tracking-wider text-faint px-1">Project</label>
                <select
                  class="field mt-1.5 text-[13px]"
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
            <nav class="mt-5 flex flex-col gap-0.5">
              <NavItem href={`/board?project=${project ?? ''}`} active={page === 'board'} icon="layout-grid" label="Board" />
              <NavItem href={`/agents?project=${project ?? ''}`} active={page === 'agents'} icon="users" label="Agents" />
              <NavItem href={`/inbox?project=${project ?? ''}`} active={page === 'inbox'} icon="inbox" label="Inbox" />
              <NavItem href={`/activity?project=${project ?? ''}`} active={page === 'activity'} icon="activity" label="Activity" />
            </nav>
          </div>

          <div class="px-4 mt-5">
            <div class="text-[11px] uppercase tracking-wider text-faint px-1 mb-1.5">Team</div>
            <div
              id="sidebar-agents"
              hx-get={`/agents/sidebar?project=${project ?? ''}`}
              hx-trigger="load, sse:agent.status_changed from:body, sse:agent.heartbeat_started from:body, sse:agent.heartbeat_ended from:body"
              hx-swap="innerHTML"
            >
              <div class="text-[12px] text-faint px-1 py-1">Loading…</div>
            </div>
          </div>

          <div class="absolute bottom-5 left-5 right-5 w-[228px]">
            <button
              hx-post="/api/daemon/pause"
              hx-swap="none"
              class="btn w-full justify-center text-[12px]"
              style="color: var(--danger); border-color: var(--danger-soft)"
            >
              <i data-lucide="pause"></i> Pause all agents
            </button>
          </div>
        </aside>

        {/* Main */}
        <main class="flex-1 min-w-0">
          <header class="px-8 py-5 flex items-center justify-between border-b border-soft" style="background: var(--bg)">
            <div>
              <h1 class="text-[24px] font-semibold leading-tight serif">{title}</h1>
              {project && (
                <p class="text-[12px] text-faint mt-1 mono flex items-center gap-1.5">
                  <i data-lucide="folder" class="icon-sm"></i>
                  {project}
                </p>
              )}
            </div>
            <div
              id="usage-widget"
              class="flex items-center gap-2"
              hx-get="/usage/widget"
              hx-trigger="load, sse:claude.usage_updated from:body"
              hx-swap="innerHTML"
            >
              <span class="text-[12px] text-faint">loading…</span>
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
      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ' +
      (active
        ? 'font-medium'
        : 'text-muted hover-bg')
    }
    style={active ? 'background: var(--accent-soft); color: var(--accent)' : ''}
  >
    <i data-lucide={icon}></i>
    <span>{label}</span>
  </a>
);
