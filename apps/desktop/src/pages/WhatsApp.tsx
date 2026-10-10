import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { nextMsgId } from '../lib/messageIds';
import { TPL } from '../data/seed';
import { missing } from '../lib/domain';
import { fDate, fTime, fDT, until, agoT, dayDiff, vnow, toInput } from '../lib/format';
import type { ChatMsg, Reminder } from '../types';

function dayLabel(d: Date) {
  const n = dayDiff(vnow(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fDate(d);
}

function fillTpl(body: string, name: string) {
  return body.replace(/\{(\w+)\}/g, (_, k) => (k === 'name' ? name : k === 'period' ? 'August 2026' : k === 'due' ? '20 Sep 2026' : k === 'filing' ? 'GSTR-3B' : k === 'doc' ? 'bank statement' : '—'));
}

export function WhatsAppPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [input, setInput] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const c = s.clients.find((x) => x.id === s.ui.wa.client) || s.clients[0];
  const thread = c ? (s.threads[c.id] || []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()) : [];

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread.length, s.ui.wa.tab]);

  if (!c) {
    return (
      <>
        <div className="ph"><div><h1>WhatsApp</h1><p>Every client conversation in one place, with the reminders that will go out next.</p></div></div>
        <div className="card"><div className="card-b empty"><b>No clients yet</b>Add a client before starting a WhatsApp conversation.</div></div>
      </>
    );
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    const msg: ChatMsg = { id: nextMsgId(), f: 'me', t: text, at: vnow(), st: 'sent' };
    dispatch({ type: 'WA_APPEND', client: c.id, msg });
    setInput('');
    setTimeout(() => {
      const wantsDoc = /bank|invoice|bill|document|send|share|statement|receipt/i.test(text);
      dispatch({
        type: 'WA_APPEND',
        client: c.id,
        msg: { id: nextMsgId(), f: 'cl', t: wantsDoc ? 'Sending the files now.' : 'Ok sir, will send today.', at: vnow(), st: 'read' },
      });
    }, 1800);
  }

  const scheduled = s.reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <>
      <div className="ph">
        <div><h1>WhatsApp</h1><p>Every client conversation in one place, with the reminders that will go out next.</p></div>
        <div className="ph-a"><button className="btn pri" onClick={() => setShowSchedule(true)}><Icon name="plus" size={14} />Schedule reminder</button></div>
      </div>

      <div className="card wa-top">
        <span className="chip green"><i className="sdot" style={{ margin: '0 2px 0 0' }} />Business API connected</span>
        <span className="mut2">+91 99000 00000 · {TPL.length} templates approved</span>
      </div>

      <div className="tabs">
        {(['chats', 'reminders', 'templates'] as const).map((t) => (
          <button key={t} className={s.ui.wa.tab === t ? 'on' : ''} onClick={() => dispatch({ type: 'WA_TAB', tab: t })}>
            {t === 'chats' ? 'Chats' : t === 'reminders' ? `Scheduled reminders (${scheduled.length})` : 'Templates'}
          </button>
        ))}
      </div>

      {s.ui.wa.tab === 'chats' && (
        <div className="card wa">
          <div className="wa-l">
            {s.clients.map((cl) => {
              const th = s.threads[cl.id] || [];
              const last = th.filter((m) => m.f !== 'sys').slice(-1)[0];
              const m = missing(s.checks, cl.id).length;
              return (
                <div key={cl.id} className={'wa-c' + (s.ui.wa.client === cl.id ? ' on' : '')} onClick={() => dispatch({ type: 'WA_CLIENT', id: cl.id })}>
                  <span className="av" style={{ ['--t' as any]: cl.tone }}>{cl.short.slice(0, 2).toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row"><span className="nm">{cl.short}</span><span className="sp" /><span className="tm">{last ? agoT(last.at) : ''}</span></div>
                    <div className="row"><span className="pv">{last ? (last.file ? `Attachment: ${last.file}` : last.t) : 'No messages yet'}</span>{m ? <span className="chip amber" style={{ marginLeft: 'auto', padding: '0 7px' }}>{m}</span> : null}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="wa-r">
            <div className="wa-h">
              <div className="row">
                <span className="av lg" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div><b>{c.name}</b><div className="mut" style={{ fontSize: 12 }}>{c.contact} · {c.phone}</div></div>
                <span className="sp" />
              </div>
              <div className="ckl">
                {s.checks[c.id]?.map((x, i) => (
                  <span key={i} className={'chip ' + (x.ok ? 'green' : 'amber')}><Icon name={x.ok ? 'check' : 'clock'} size={12} />{x.n}</span>
                ))}
              </div>
            </div>
            <div id="wa-thread" ref={threadRef}>
              {(() => {
                let last = '';
                return thread.map((m) => {
                  const dl = dayLabel(m.at);
                  const sep = dl !== last ? (last = dl, <div key={'sep' + m.id} className="dsep">{dl}</div>) : null;
                  return (
                    <>
                      {sep}
                      {m.f === 'sys' ? (
                        <div key={m.id} className="sys"><Icon name="bolt" size={12} />{m.t}</div>
                      ) : (
                        <div key={m.id} className={'msg ' + m.f}>
                          {m.file && (
                            <div className="att"><Icon name="file" size={18} /><div><div className="mono" style={{ fontSize: 11.5 }}>{m.file}</div><div style={{ fontSize: 10.5, opacity: 0.75 }}>Captured to client folder</div></div></div>
                          )}
                          {m.t}
                          <span className="mt">{fTime(m.at)}{m.auto ? ' · automated' : ''}</span>
                        </div>
                      )}
                    </>
                  );
                });
              })()}
              {scheduled.filter((r) => r.client === c.id).length > 0 && <div className="dsep">Scheduled</div>}
              {scheduled.filter((r) => r.client === c.id).map((r) => (
                <div key={r.id} className="msg me sched">
                  <div className="sh">
                    <Icon name="clock" size={13} /><span>{fDT(r.at)} · {until(r.at)}</span>
                    {r.approve ? <span className="chip amber">Needs your approval</span> : <span className="chip green">Auto-send</span>}
                  </div>
                  {r.text}
                  <div className="sa">
                    {r.approve && <button className="btn sm" onClick={() => dispatch({ type: 'REM_APPROVE', id: r.id })}>Approve</button>}
                    <button className="btn sm" onClick={() => dispatch({ type: 'REM_SEND_NOW', id: r.id })}>Send now</button>
                    <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="wa-f">
              <select
                className="sel"
                aria-label="Insert template"
                onChange={(e) => { if (e.target.value) { const t = TPL.find((x) => x.id === e.target.value)!; setInput(fillTpl(t.body, c.contact.split(' ')[0])); e.target.value = ''; } }}
              >
                <option value="">Insert template</option>
                {TPL.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input className="inp" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={`Message ${c.contact.split(' ')[0]}`} />
              <button className="btn pri" onClick={send} aria-label="Send message"><Icon name="send" size={15} /></button>
            </div>
          </div>
        </div>
      )}

      {s.ui.wa.tab === 'reminders' && (
        <div className="tline">
          {scheduled.map((r) => {
            const cl = s.clients.find((x) => x.id === r.client)!;
            return (
              <div key={r.id} className="card rem">
                <div className="rt">{fTime(r.at)}<small>{until(r.at)}</small></div>
                <div style={{ minWidth: 0 }}>
                  <div className="row"><span className="av" style={{ ['--t' as any]: cl.tone }}>{cl.short.slice(0, 2).toUpperCase()}</span><b>{cl.name}</b></div>
                  <p>{r.text}</p>
                </div>
                <div className="row">
                  {r.approve ? <button className="btn sm" onClick={() => dispatch({ type: 'REM_APPROVE', id: r.id })}>Approve</button> : null}
                  <button className="btn sm" onClick={() => dispatch({ type: 'REM_SEND_NOW', id: r.id })}>Send now</button>
                  <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}><Icon name="x" size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {s.ui.wa.tab === 'templates' && (
        <div className="grid g3">
          {TPL.map((t) => (
            <div key={t.id} className="card tpl">
              <div className="row"><b>{t.name}</b><span className="sp" /><span className="chip blue">Utility</span></div>
              <p>{t.body}</p>
            </div>
          ))}
        </div>
      )}

      {showSchedule && <ScheduleModal onClose={() => setShowSchedule(false)} defaultClient={c.id} />}
    </>
  );
}

function ScheduleModal({ onClose, defaultClient }: { onClose: () => void; defaultClient: string }) {
  const s = useAppState();
  const dispatch = useDispatch();
  const [client, setClient] = useState(defaultClient);
  const [tpl, setTpl] = useState('pending');
  const d = new Date(vnow()); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  const [when, setWhen] = useState(toInput(d));
  const c = s.clients.find((x) => x.id === client)!;
  const t = TPL.find((x) => x.id === tpl)!;
  const [text, setText] = useState(fillTpl(t.body, c.contact.split(' ')[0]));

  return (
    <div className="modal" role="dialog" aria-label="Schedule reminder" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mbox">
        <h2>Schedule a WhatsApp reminder</h2>
        <div className="mgrid">
          <div className="mrow">
            <label className="f">Client</label>
            <select className="sel" value={client} onChange={(e) => { setClient(e.target.value); const cc = s.clients.find((x) => x.id === e.target.value)!; setText(fillTpl(t.body, cc.contact.split(' ')[0])); }}>
              {s.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>
          <div className="mrow">
            <label className="f">Template</label>
            <select className="sel" value={tpl} onChange={(e) => { setTpl(e.target.value); const tt = TPL.find((x) => x.id === e.target.value)!; setText(fillTpl(tt.body, c.contact.split(' ')[0])); }}>
              {TPL.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
            </select>
          </div>
          <div className="mrow"><label className="f">Send on</label><input className="inp" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        </div>
        <div className="mrow"><label className="f">Message preview</label><textarea className="inp" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn gh" onClick={onClose}>Cancel</button>
          <button
            className="btn pri"
            onClick={() => {
              const at = new Date(when);
              const reminder: Reminder = { id: 'r' + Date.now(), client, tpl, at, repeat: 'Once', approve: true, status: 'scheduled', text };
              dispatch({ type: 'REM_SCHEDULE', reminder });
              onClose();
            }}
          >
            <Icon name="clock" size={14} />Schedule reminder
          </button>
        </div>
      </div>
    </div>
  );
}
