/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

export interface LayoutProps {
  title?: string;
  project?: string;
  projects?: string[];
  page?: 'board' | 'agents' | 'activity' | 'inbox' | 'goals' | 'settings' | 'metrics';
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
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
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
            font-size: 15px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          h1, h2, h3 { letter-spacing: -0.015em; }
          .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: -0.01em; }
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
            display: inline-flex; align-items: center; justify-content: center; gap: 8px;
            height: 38px; padding: 0 16px; border-radius: 10px; font-size: 14px; font-weight: 500;
            border: 1px solid var(--border); background: var(--surface); color: var(--ink);
            transition: background 120ms, border-color 120ms, transform 80ms;
            white-space: nowrap; cursor: pointer;
          }
          .btn:hover { background: var(--surface-alt); }
          .btn:active { transform: scale(0.98); }
          .btn-primary {
            background: var(--accent); color: #fff; border-color: var(--accent);
          }
          .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
          .btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
          .btn-success { background: var(--success); color: #fff; border-color: var(--success); }
          .btn-sm { height: 30px; padding: 0 10px; font-size: 13px; border-radius: 8px; }
          .pill {
            display: inline-flex; align-items: center; gap: 5px; height: 30px;
            padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 500;
            border: 1px solid var(--border); color: var(--ink-muted);
            background: var(--surface);
            transition: background 120ms, color 120ms, border-color 120ms;
            cursor: pointer;
          }
          .pill:hover { background: var(--surface-alt); color: var(--ink); }
          .pill-active { background: var(--accent); color: #fff; border-color: var(--accent); }
          .pill-active:hover { background: var(--accent-hover); color: #fff; }
          .field {
            width: 100%; height: 38px; padding: 0 12px; border-radius: 10px;
            border: 1px solid var(--border); background: var(--surface);
            font-size: 14px; color: var(--ink); outline: none;
            transition: border-color 120ms, box-shadow 120ms;
          }
          .field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
          textarea.field { resize: vertical; min-height: 80px; height: auto; padding: 10px 12px; }
          select.field { padding-right: 28px; }

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

          /* Loading skeleton: animated shimmer while htmx content loads */
          .skel {
            position: relative; overflow: hidden;
            background: var(--surface-alt);
            border-radius: 8px;
          }
          .skel::after {
            content: ''; position: absolute; inset: 0;
            transform: translateX(-100%);
            background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%);
            animation: skel-shimmer 1.4s ease-in-out infinite;
          }
          @keyframes skel-shimmer { 100% { transform: translateX(100%); } }
          .skel-line { height: 12px; margin: 6px 0; }
          .skel-avatar { width: 20px; height: 20px; border-radius: 9999px; }

          /* Pulse (for working agents) */
          .pulse-dot { position: relative; }
          .pulse-dot::before { content: ''; position: absolute; inset: -3px; border-radius: 9999px; background: inherit; opacity: 0.35; animation: pulse 1.6s ease-out infinite; }
          @keyframes pulse { 0% { transform: scale(1); opacity: 0.35; } 100% { transform: scale(2); opacity: 0; } }

          /* Lucide icon sizing defaults */
          [data-lucide] { width: 18px; height: 18px; stroke-width: 2; flex-shrink: 0; }
          .icon-sm [data-lucide], [data-lucide].icon-sm { width: 15px; height: 15px; }
          .icon-lg [data-lucide], [data-lucide].icon-lg { width: 24px; height: 24px; }

          /* Mobile responsive: collapse sidebar, drawer becomes full-width,
             header padding tightens. The sidebar is hidden behind a toggle
             that slides it in from the left. */
          .sidebar-toggle { display: none; }
          @media (max-width: 900px) {
            .sidebar-toggle {
              display: inline-flex; align-items: center; justify-content: center;
              height: 38px; width: 38px; border-radius: 10px; border: 1px solid var(--border);
              background: var(--surface); cursor: pointer;
            }
            aside.hq-sidebar {
              position: fixed; inset: 0 auto 0 0; z-index: 40;
              transform: translateX(-100%); transition: transform 180ms ease-out;
            }
            body.sidebar-open aside.hq-sidebar { transform: translateX(0); }
            body.sidebar-open::after {
              content: ''; position: fixed; inset: 0; background: rgba(31,30,26,0.35); z-index: 35;
            }
            main.hq-main > header { padding: 16px 20px; }
            main.hq-main > div { padding: 18px 20px 24px; }
            main.hq-main h1 { font-size: 22px; }
            .drawer { width: 100vw !important; }
          }
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
          function hqToggleSidebar(){
            document.body.classList.toggle('sidebar-open');
          }
          // Browser Notification API — opt-in, persists the choice in
          // localStorage. We only fire notifications when the tab is NOT
          // focused; focused users already see the toast.
          function hqNotifyEnabled(){ return localStorage.getItem('hq.notifyEnabled') === '1'; }
          function hqRequestNotify(){
            if (!('Notification' in window)) return;
            Notification.requestPermission().then((p) => {
              localStorage.setItem('hq.notifyEnabled', p === 'granted' ? '1' : '0');
              const btn = document.getElementById('notify-toggle');
              if (btn) btn.textContent = p === 'granted' ? 'Notifications on' : 'Notifications off';
            });
          }
          function hqNotify(title, body){
            if (!hqNotifyEnabled()) return;
            if (document.visibilityState === 'visible') return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try { new Notification(title, { body, icon: '/favicon.ico', tag: 'hq' }); } catch {}
          }
          function hqInit(){
            if (window.lucide) window.lucide.createIcons();
            const btn = document.getElementById('notify-toggle');
            if (btn) {
              const perm = ('Notification' in window) ? Notification.permission : 'default';
              btn.textContent = perm === 'granted' && hqNotifyEnabled()
                ? 'Notifications on' : 'Enable notifications';
            }
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
                const label = ev.replace(/\\./g,' ');
                const html = '<i data-lucide="'+(icon[ev]||'dot')+'" style="color:var(--accent)"></i><div><div style="font-weight:500">' + label + '</div><div style="color:var(--ink-muted);font-size:11px">' + who + sub + '</div></div>';
                hqShowToast(html, 'info');
                // Native notification only for the events the operator
                // actually needs to act on when the tab isn't focused.
                const isCritical =
                  (ev === 'task.status_changed' && d.to === 'review') ||
                  ev === 'task.blocked' ||
                  ev === 'message.sent';
                if (isCritical) {
                  hqNotify(label, [who, sub].filter(Boolean).join(' '));
                }
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
          document.addEventListener('configSaved', () => {
            hqShowToast('<i data-lucide="check" style="color:var(--success)"></i><div style="font-weight:500">Settings saved</div>', 'success');
            if (window.lucide) window.lucide.createIcons();
          });
          document.addEventListener('DOMContentLoaded', hqInit);
        `,
        }}
      />
    </head>
    <body
      class="h-screen overflow-hidden"
      hx-ext="sse"
      sse-connect={`/events${project ? `?project=${project}` : ''}`}
    >
      <div class="flex h-screen">
        {/* Sidebar */}
        <aside class="hq-sidebar w-[280px] shrink-0 border-r border-soft flex flex-col h-screen" style="background: var(--surface-alt)">
          <div class="p-5 flex-1 overflow-y-auto">
            <div class="flex items-center gap-2.5 px-1">
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                style="background: var(--accent)"
              >
                <i data-lucide="sparkles"></i>
              </div>
              <span class="font-semibold text-[17px]">HQ</span>
            </div>
            {projects.length > 0 && (
              <div class="mt-6">
                <label class="text-[11px] font-semibold uppercase tracking-wider text-faint px-1">Project</label>
                <select
                  class="field mt-2"
                  onchange="hqSwitchProject(this.value)"
                >
                  {projects.map((p) => (
                    <option value={p} selected={p === project}>
                      {p}
                    </option>
                  ))}
                </select>
                {projects.length > 1 && (
                  <a
                    href="/board/all"
                    class="text-[12px] text-muted mt-2 inline-flex items-center gap-1.5 hover:text-[color:var(--accent)]"
                  >
                    <i data-lucide="layout-dashboard" class="icon-sm"></i>
                    All projects
                  </a>
                )}
              </div>
            )}
            <nav class="mt-6 flex flex-col gap-1">
              <NavItem href={`/board?project=${project ?? ''}`} active={page === 'board'} icon="layout-grid" label="Board" />
              <NavItem href={`/agents?project=${project ?? ''}`} active={page === 'agents'} icon="users" label="Agents" />
              <NavItem
                href={`/inbox?project=${project ?? ''}`}
                active={page === 'inbox'}
                icon="inbox"
                label="Inbox"
                badgeUrl={`/inbox/unread?project=${project ?? ''}`}
              />
              <NavItem href={`/activity?project=${project ?? ''}`} active={page === 'activity'} icon="activity" label="Activity" />
              <NavItem href={`/goals?project=${project ?? ''}`} active={page === 'goals'} icon="target" label="Goals" />
              <NavItem href={`/metrics?project=${project ?? ''}`} active={page === 'metrics'} icon="bar-chart-2" label="Metrics" />
              <NavItem href={`/settings?project=${project ?? ''}`} active={page === 'settings'} icon="settings" label="Settings" />
            </nav>

            <div class="mt-7">
              <div class="text-[11px] font-semibold uppercase tracking-wider text-faint px-1 mb-2">Team</div>
              <div
                id="sidebar-agents"
                hx-get={`/agents/sidebar?project=${project ?? ''}`}
                hx-trigger="load, sse:agent.status_changed from:body, sse:agent.heartbeat_started from:body, sse:agent.heartbeat_ended from:body"
                hx-swap="innerHTML"
              >
                <ul class="flex flex-col gap-0.5 px-1 py-1">
                  {[0, 1, 2].map(() => (
                    <li class="flex items-center gap-2.5 py-1.5">
                      <span class="skel skel-avatar" />
                      <span class="skel skel-line flex-1" style="max-width: 120px" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div class="p-5 border-t border-soft flex flex-col gap-2">
            <div
              id="health-widget"
              class="px-1 pb-1"
              hx-get="/health/widget"
              hx-trigger="load, every 30s"
              hx-swap="innerHTML"
            >
              <span class="skel" style="width:100%; height:14px; display:block" />
            </div>
            <button
              id="notify-toggle"
              type="button"
              onclick="hqRequestNotify()"
              class="btn w-full justify-center"
            >
              <i data-lucide="bell"></i>
              Enable notifications
            </button>
            <button
              hx-post="/api/daemon/resume"
              hx-swap="none"
              class="btn w-full justify-center"
              style="color: var(--accent); border-color: var(--accent)"
            >
              <i data-lucide="play"></i> Start agents
            </button>
            <button
              hx-post="/api/daemon/pause"
              hx-swap="none"
              class="btn w-full justify-center"
              style="color: var(--danger); border-color: var(--danger-soft)"
            >
              <i data-lucide="pause"></i> Pause all agents
            </button>
          </div>
        </aside>

        {/* Main */}
        <main class="hq-main flex-1 min-w-0 flex flex-col h-screen">
          <header class="px-10 py-6 flex items-center justify-between border-b border-soft shrink-0 gap-3" style="background: var(--bg)">
            <div class="flex items-center gap-3 min-w-0">
              <button
                type="button"
                class="sidebar-toggle"
                onclick="hqToggleSidebar()"
                aria-label="Open menu"
              >
                <i data-lucide="menu"></i>
              </button>
              <div class="min-w-0">
              <h1 class="text-[28px] font-semibold leading-tight">{title}</h1>
              {project && (
                <p class="text-[13px] text-faint mt-1.5 mono flex items-center gap-1.5 truncate">
                  <i data-lucide="folder" class="icon-sm"></i>
                  {project}
                </p>
              )}
              </div>
            </div>
            <div
              id="usage-widget"
              class="flex items-center gap-2 flex-wrap justify-end"
              hx-get="/usage/widget"
              hx-trigger="load, sse:claude.usage_updated from:body"
              hx-swap="innerHTML"
            >
              <span class="skel" style="width: 78px; height: 26px; border-radius: 999px" />
              <span class="skel" style="width: 78px; height: 26px; border-radius: 999px" />
              <span class="skel" style="width: 78px; height: 26px; border-radius: 999px" />
            </div>
          </header>
          <div class="flex-1 min-h-0 px-10 py-7 flex flex-col overflow-y-auto">{children}</div>
        </main>
      </div>

      <div id="toasts"></div>
    </body>
  </html>
);

const NavItem: FC<{
  href: string;
  active: boolean;
  icon: string;
  label: string;
  badgeUrl?: string;
}> = ({ href, active, icon, label, badgeUrl }) => (
  <a
    href={href}
    class={
      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[14px] transition-colors ' +
      (active ? 'font-semibold' : 'text-muted hover-bg')
    }
    style={active ? 'background: var(--accent-soft); color: var(--accent)' : ''}
  >
    <i data-lucide={icon}></i>
    <span>{label}</span>
    {badgeUrl && (
      <span
        class="ml-auto"
        hx-get={badgeUrl}
        hx-trigger="load, sse:message.sent from:body, every 30s"
        hx-swap="innerHTML"
      />
    )}
  </a>
);
