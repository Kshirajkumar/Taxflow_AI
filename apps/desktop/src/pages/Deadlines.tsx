import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, TaskInfo } from '../lib/domain';
import { STEPS } from '../data/seed';
import { fDate, sum } from '../lib/format';

export function DeadlinesPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const all = allTasks(s.tasks);
  const over = all.filter((x) => x.st === 'overdue').length;
  const soon = all.filter((x) => x.st !== 'done' && x.days >= 0 && x.days <= 7).length;
  const done = all.filter((x) => x.st === 'done').length;

  return (
    <>
      <div className="ph"><div><h1>Deadlines</h1><p>Track every filing for every client. Tick steps as work gets done.</p></div></div>
      <div className="grid g4">
        <div className="card kpi"><span>Overdue</span><b style={{ color: 'var(--red)' }}>{over}</b><em>Needs action now</em></div>
        <div className="card kpi"><span>Due in 7 days</span><b style={{ color: 'var(--amber)' }}>{soon}</b><em>Filings coming up</em></div>
        <div className="card kpi"><span>Complete</span><b style={{ color: 'var(--green)' }}>{done}</b><em>of {all.length} filings</em></div>
        <div className="card kpi"><span>Clients tracked</span><b>{s.clients.length}</b><em>Across all filing types</em></div>
      </div>

      {s.clients.map((c) => {
        const mine = all.filter((x) => x.t.client === c.id);
        if (!mine.length) return null;
        const steps = sum(mine, (x) => x.total);
        const sd = sum(mine, (x) => x.done);
        const pct = Math.round((sd / steps) * 100);
        const ov = mine.filter((x) => x.st === 'overdue').length;
        const dn = mine.filter((x) => x.st === 'done').length;
        const o = s.ui.dl.open.has(c.id);
        return (
          <div key={c.id} className="card dcl" style={{ marginTop: 14 }}>
            <div className="dcl-h" onClick={() => dispatch({ type: 'DL_TOGGLE', client: c.id })}>
              <div className="row">
                <span className="av" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div><b>{c.name}</b><div className="mut" style={{ fontSize: 12 }}>{c.city} · {mine.length} filings</div></div>
              </div>
              <div>
                <div className="row" style={{ marginBottom: 6 }}><span className="pc">{pct}%</span><span className="mut" style={{ fontSize: 12 }}>{sd} of {steps} steps done</span></div>
                <div className={'bar ' + (ov ? 'bad' : pct === 100 ? 'ok' : '')}><i style={{ width: pct + '%' }} /></div>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className="chip green">{dn} done</span>
                <span className="chip amber">{mine.length - dn} pending</span>
                {ov > 0 && <span className="chip red">{ov} overdue</span>}
              </div>
              <span className={'caret' + (o ? ' o' : '')}><Icon name="chev" size={14} /></span>
            </div>
            {o && (
              <div className="dcl-b">
                {mine.sort((a, b) => a.days - b.days).map((x: TaskInfo) => (
                  <div key={x.t.id} className="task">
                    <div className="task-r">
                      <div><b>{x.t.name}</b><div><span className="chip">{x.t.cat}</span></div></div>
                      <div>{fDate(x.t.due)}<div style={{ marginTop: 3 }}>
                        <span className={'chip ' + (x.st === 'overdue' ? 'red' : x.st === 'done' ? 'green' : x.st === 'soon' ? 'amber' : '')}>
                          {x.st === 'done' ? 'Complete' : x.st === 'overdue' ? `${Math.abs(x.days)} d overdue` : x.days === 0 ? 'Due today' : `${x.days} d left`}
                        </span>
                      </div></div>
                      <div>
                        <div className="mut" style={{ fontSize: 12, marginBottom: 5 }}>{x.done}/{x.total} steps · {x.pct}%</div>
                        <div className={'bar ' + (x.st === 'overdue' ? 'bad' : x.st === 'done' ? 'ok' : x.st === 'soon' ? 'warn' : '')}><i style={{ width: x.pct + '%' }} /></div>
                      </div>
                      <div />
                    </div>
                    <div className="steps">
                      {x.t.steps.map((done, i) => (
                        <button key={i} className={'stp' + (done ? ' d' : '')} onClick={() => dispatch({ type: 'STEP_TOGGLE', taskId: x.t.id, index: i })}>
                          <span className="bx"><Icon name="check" size={11} /></span><span>{STEPS[x.t.cat]?.[i]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
