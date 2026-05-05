const proposalsEl = document.getElementById('proposals');
const lastRefreshEl = document.getElementById('last-refresh');

function severityClass(s) {
  return { critical: 'badge-critical', high: 'badge-high', medium: 'badge-medium', low: 'badge-low' }[s] ?? '';
}

function renderProposal(p) {
  const route = p.route;
  const cls = p.classification;
  const drafts = p.drafts;
  const research = p.research;

  const div = document.createElement('div');
  div.className = 'proposal';
  div.id = `proposal-${p.id}`;

  const related = (research.related ?? []).map(i =>
    `<li><a href="${i.url}" target="_blank">#${i.number}: ${escHtml(i.title)} (${i.state})</a></li>`
  ).join('') || '<li style="color:#94a3b8">None found</li>';

  div.innerHTML = `
    <div class="proposal-header">
      <div>
        <div class="proposal-subject">${escHtml(p.subject)}</div>
        <div class="meta">From: ${escHtml(p.from_address)} &nbsp;·&nbsp; Repo: <strong>${escHtml(route.winner.name)}</strong></div>
      </div>
      <div class="badges">
        <span class="badge ${severityClass(cls.severity)}">${cls.severity}</span>
        <span class="badge badge-category">${cls.category}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Issue title</div>
      <div class="section-content">${escHtml(drafts.issueTitle)}</div>
    </div>

    <div class="section">
      <div class="section-label">Issue body (preview)</div>
      <div class="section-content">${escHtml(drafts.issueBody)}</div>
    </div>

    <div class="section">
      <div class="section-label">Email reply (preview)</div>
      <div class="section-content">${escHtml(drafts.emailReplyBody)}</div>
    </div>

    <div class="section">
      <div class="section-label">Related issues (${(research.related ?? []).length})</div>
      <ul class="related-issues">${related}</ul>
    </div>

    <div class="actions">
      <button class="btn-approve" onclick="approve(${p.id}, this)">Approve &amp; file</button>
      <button class="btn-reject" onclick="reject(${p.id}, this)">Reject</button>
    </div>
    <div class="result-link" id="result-${p.id}"></div>
  `;

  return div;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function approve(id, btn) {
  btn.disabled = true;
  btn.nextElementSibling.disabled = true;
  btn.textContent = 'Filing…';

  try {
    const res = await fetch(`/api/proposals/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'unknown error');
    const resultEl = document.getElementById(`result-${id}`);
    resultEl.innerHTML = `✅ Filed: <a href="${data.githubUrl}" target="_blank">${data.githubUrl}</a>`;
    btn.closest('.proposal').style.opacity = '0.5';
  } catch (err) {
    btn.textContent = 'Approve & file';
    btn.disabled = false;
    btn.nextElementSibling.disabled = false;
    alert('Error: ' + err.message);
  }
}

async function reject(id, btn) {
  btn.disabled = true;
  btn.previousElementSibling.disabled = true;

  try {
    const res = await fetch(`/api/proposals/${id}/reject`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error ?? 'unknown error');
    const resultEl = document.getElementById(`result-${id}`);
    resultEl.textContent = '🚫 Rejected';
    btn.closest('.proposal').style.opacity = '0.5';
  } catch (err) {
    btn.disabled = false;
    btn.previousElementSibling.disabled = false;
    alert('Error: ' + err.message);
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/proposals');
    const proposals = await res.json();

    proposalsEl.innerHTML = '';
    if (proposals.length === 0) {
      proposalsEl.innerHTML = '<div class="empty">No pending proposals. The poller will add new ones as emails arrive.</div>';
    } else {
      proposals.forEach(p => proposalsEl.appendChild(renderProposal(p)));
    }

    lastRefreshEl.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    lastRefreshEl.textContent = 'Refresh failed: ' + err.message;
  }
}

refresh();
setInterval(refresh, 10000);
