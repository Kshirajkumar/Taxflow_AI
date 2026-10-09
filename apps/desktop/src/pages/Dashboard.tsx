import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, missing } from '../lib/domain';
import { fDate, fTime, fShort, until, agoT, dayDiff, vnow } from '../lib/format';

export function Dashboard() {
  const s = useAppState();
  const dispatch = useDispatch();
  const ti = allTasks(s.tasks);
  const over = ti.filter((x) => x.st === 'overdue').length;
  const week = ti.filter((x) => x.st !== 'done' && x.days >= 0 && x.days <= 7).length;
  const ext = s.docs.filter((d) => d.status !== 'queued').length;
  const queued = s.docs.filter((d) => d.status === 'queued').length;
  const sch = s.reminders.filter((r) => r.status === 'scheduled').length;
  const att = ti.filter((x) => x.st !== 'done').sort((a, b) => a.days - b.days).slice(0, 6);
  const nxt = s.reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 4);
  const missingClients = s.clients.filter((c) => missing(s.checks, c.id).length);
  const cnt = (k: string) => s.docs.filter((d) => d.status === k).length;
  const tot = s.docs.length || 1;

  return (
    <>
      <div className="ph">
        <div>
          <h1>Good morning</h1>
          <p>Saturday, 19 Sep 2026 · {over + week} filings need attention in the next 7 days</p>
        </div>
      </div>

      <div className="grid g4">
        <div className="card kpi"><span>Active clients</span><b>{s.clients.length}</b><em>India and UAE</em></div>
        <div className="card kpi"><span>Invoices extracted</span><b>{ext}</b><em>{queued} waiting in the queue</em></div>
        <div className="card kpi"><span>Due in 7 days</span><b>{week}</b><em>{over ? <span style={{ color: 'var(--red)' }}>{over} overdue</span> : 'Nothing overdue'}</em></div>
        <div className="card kpi"><span>Reminders scheduled</span><b>{sch}</b><em>Next {nxt[0] ? until(nxt[0].at) : '—'}</em></div>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <h2>Filings that need attention</h2>
            <button className="btn sm gh" onClick={() => dispatch({ type: 'GO', page: 'deadlines' })}>Open deadlines</button>
          </div>
          <div className="card-b">
            {att.map((x) => {
              const c = s.clients.find((c) => c.id === x.t.client)!;
              return (
                <div key={x.t.id} className="list-i" onClick={() => { dispatch({ type: 'DL_TOGGLE', client: c.id }); dispatch({ type: 'GO', page: 'deadlines' }); }}>
                  <span className="av" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="li-t">{x.t.name}</div>
                    <div className="mut" style={{ fontSize: 12 }}>{c.name} · due {fDate(x.t.due)}</div>
                    <div style={{ marginTop: 6 }}>
                      <div className={'bar ' + (x.st === 'overdue' ? 'bad' : x.st === 'soon' ? 'warn' : '')}><i style={{ width: x.pct + '%' }} /></div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={'chip ' + (x.st === 'overdue' ? 'red' : x.st === 'soon' ? 'amber' : '')}>
                      {x.st === 'overdue' ? `${Math.abs(x.days)} d overdue` : x.days === 0 ? 'Due today' : `${x.days} d left`}
                    </span>
                    <div className="mut" style={{ fontSize: 11.5, marginTop: 4 }}>{x.done}/{x.total} steps</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-h">
              <h2>Next WhatsApp reminders</h2>
              <button className="btn sm gh" onClick={() => dispatch({ type: 'GO', page: 'whatsapp' })}>Open</button>
            </div>
            <div className="card-b">
              {nxt.map((r) => {
                const c = s.clients.find((c) => c.id === r.client)!;
                const t = s.threads[r.client];
                return (
                  <div key={r.id} className="list-i" onClick={() => { dispatch({ type: 'WA_CLIENT', id: c.id }); dispatch({ type: 'GO', page: 'whatsapp' }); }}>
                    <span className="av" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="li-t">{c.name}</div>
                      <div className="mut" style={{ fontSize: 12 }}>{r.tpl}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12 }}>
                      <b>{fTime(r.at)}</b>
                      <div className="mut">{dayDiff(r.at, vnow()) === 0 ? 'Today' : fShort(r.at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h2>Document pipeline</h2><small>{s.docs.length} invoices</small></div>
            <div className="card-b">
              <div className="pipe">
                <i style={{ width: (cnt('queued') / tot) * 100 + '%', background: 'var(--line2)' }} />
                <i style={{ width: (cnt('review') / tot) * 100 + '%', background: 'var(--amber)' }} />
                <i style={{ width: (cnt('extracted') / tot) * 100 + '%', background: 'var(--cyan)' }} />
                <i style={{ width: (cnt('approved') / tot) * 100 + '%', background: 'var(--green)' }} />
              </div>
              <div className="legend">
                <span><b style={{ background: 'var(--line2)' }} />Queued {cnt('queued')}</span>
                <span><b style={{ background: 'var(--amber)' }} />Review {cnt('review')}</span>
                <span><b style={{ background: 'var(--cyan)' }} />Extracted {cnt('extracted')}</span>
                <span><b style={{ background: 'var(--green)' }} />Approved {cnt('approved')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid g2e" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h"><h2>Clients missing documents</h2><small>{missingClients.length} of {s.clients.length}</small></div>
          <div className="card-b">
            {missingClients.slice(0, 5).map((c) => (
              <div key={c.id} className="list-i" onClick={() => { dispatch({ type: 'WA_CLIENT', id: c.id }); dispatch({ type: 'GO', page: 'whatsapp' }); }}>
                <span className="av" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="li-t">{c.name}</div>
                  <div className="mut" style={{ fontSize: 12 }}>{missing(s.checks, c.id).map((x) => x.n).join(', ')}</div>
                </div>
                <span className="chip amber">{missing(s.checks, c.id).length} pending</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>Automation activity</h2></div>
          <div className="card-b">
            {s.log.slice(0, 6).map((l, i) => (
              <div key={i} className="feed">
                <span className="fi"><Icon name={l.ic} size={14} /></span>
                <div><div>{l.t}</div><div className="mut" style={{ fontSize: 11.5 }}>{agoT(l.at)}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
