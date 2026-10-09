import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, missing, pendingBill } from '../lib/domain';
import { fDate, money, sum } from '../lib/format';

export function ClientsPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  return (
    <>
      <div className="ph"><div><h1>Clients</h1><p>Everyone you file for, with their services and current workload.</p></div></div>
      <div className="grid g3">
        {s.clients.map((c) => {
          const mine = allTasks(s.tasks).filter((x) => x.t.client === c.id);
          const pct = mine.length ? Math.round((sum(mine, (x) => x.done) / sum(mine, (x) => x.total)) * 100) : 0;
          const m = missing(s.checks, c.id).length;
          return (
            <div key={c.id} className="card ccard">
              <div className="row">
                <span className="av lg" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}><b>{c.name}</b><div className="mut" style={{ fontSize: 12 }}>{c.city}, {c.country}</div></div>
              </div>
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 6 }}>{c.svc.map((sv) => <span key={sv} className="chip blue">{sv}</span>)}</div>
              <div className="kvs" style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', margin: '12px 0', fontSize: 12.5 }}>
                <span className="mut">Tax ID</span><b className="mono">{c.gstin}</b>
                <span className="mut">Contact</span><b>{c.contact}</b>
                <span className="mut">Fee</span><b>{money(c.fee, c.cur)} / mo</b>
              </div>
              <div className="row" style={{ marginBottom: 5 }}><span className="mut2">Work completed</span><span className="sp" /><b>{pct}%</b></div>
              <div className="bar"><i style={{ width: pct + '%' }} /></div>
              <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap', gap: 6 }}>
                {m ? <span className="chip amber">{m} documents missing</span> : <span className="chip green">All documents received</span>}
              </div>
              <div className="row"><button className="btn sm" onClick={() => { dispatch({ type: 'WA_CLIENT', id: c.id }); dispatch({ type: 'GO', page: 'whatsapp' }); }}><Icon name="chat" size={13} />Chat</button></div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function BillingPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const FX: Record<string, number> = { INR: 1, AED: 22.8, GBP: 108 };
  const inr = (b: (typeof s.bills)[0]) => b.amt * FX[s.clients.find((c) => c.id === b.client)!.cur];
  const paid = sum(s.bills.filter((b) => b.status === 'paid'), inr);
  const pend = sum(s.bills.filter((b) => b.status === 'pending'), inr);
  const ov = sum(s.bills.filter((b) => b.status === 'overdue'), inr);
  const L = (v: number) => `₹${(v / 1e5).toFixed(2)} L`;

  return (
    <>
      <div className="ph"><div><h1>Billing &amp; fees</h1><p>Your own fee invoices, who has paid, and who needs a nudge.</p></div></div>
      <div className="grid g4">
        <div className="card kpi"><span>Collected</span><b style={{ color: 'var(--green)' }}>{L(paid)}</b></div>
        <div className="card kpi"><span>Pending</span><b>{L(pend)}</b></div>
        <div className="card kpi"><span>Overdue</span><b style={{ color: 'var(--red)' }}>{L(ov)}</b></div>
        <div className="card kpi"><span>Collection rate</span><b>{Math.round((paid / (paid + pend + ov)) * 100)}%</b></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ overflow: 'auto' }}>
          <table>
            <thead><tr><th>Invoice</th><th>Client</th><th>For</th><th>Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {s.bills.slice().sort((a, b) => a.due.getTime() - b.due.getTime()).map((b) => {
                const c = s.clients.find((x) => x.id === b.client)!;
                return (
                  <tr key={b.no}>
                    <td className="mono">{b.no}</td>
                    <td><div className="row"><span className="av" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>{c.short}</div></td>
                    <td>{b.desc}</td>
                    <td><b>{money(b.amt, c.cur)}</b></td>
                    <td>{fDate(b.due)}</td>
                    <td>{b.status === 'paid' ? <span className="chip green">Paid</span> : b.status === 'overdue' ? <span className="chip red">Overdue</span> : <span className="chip amber">Pending</span>}</td>
                    <td style={{ textAlign: 'right' }}>{b.status !== 'paid' && <button className="btn sm gh" onClick={() => dispatch({ type: 'BILL_PAID', no: b.no })}>Mark paid</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function SettingsPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const row = (title: string, desc: string, key: keyof typeof s.settings) => (
    <div className="setrow" key={key}>
      <div className="tx"><b>{title}</b><small>{desc}</small></div>
      <button className={'tg' + (s.settings[key] ? ' on' : '')} role="switch" aria-checked={s.settings[key]} onClick={() => dispatch({ type: 'SETTING_TOGGLE', key })} />
    </div>
  );
  return (
    <>
      <div className="ph"><div><h1>Settings</h1><p>Connections, automation rules and security.</p></div></div>
      <div className="card">
        <div className="card-b">
          {row('Extract new bills automatically', 'Read every bill as soon as it reaches a client folder', 'autoExtract')}
          {row('Remind clients before deadlines', 'Schedule a document request before each due date', 'autoRemind')}
          {row('Ask me before anything is sent', 'Reminders wait for your approval unless turned off', 'approve')}
          {row('Block duplicate invoices', 'Flag an invoice number that already exists for the same party', 'dupes')}
        </div>
      </div>
    </>
  );
}
