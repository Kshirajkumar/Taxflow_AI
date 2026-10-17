import { Icon } from '../components/Icon';
import { useAppState } from '../state/store';

const PLANS = [
  {
    name: 'Starter',
    price: '249',
    description: 'For freelancers and very small firms',
    limits: ['1 user', 'Up to 30 clients', '600 documents / month', '600 utility messages included'],
    features: ['WhatsApp collection and reminders', 'Deadline tracking and client vault', 'Excel and CSV exports'],
  },
  {
    name: 'Growth',
    price: '799',
    description: 'For boutique firms and tax consultancies',
    limits: ['5 users', 'Up to 120 clients', '3,000 documents / month', '2,400 utility messages included'],
    features: ['Accounting software exports', 'VAT and corporate tax workings', 'Client portal and Arabic templates'],
    recommended: true,
  },
  {
    name: 'Practice',
    price: '1,999',
    description: 'For larger firms',
    limits: ['15 users', 'Up to 400 clients', '12,000 documents / month', '8,000 utility messages included'],
    features: ['API access and audit log export', 'E-invoice readiness connector', 'Custom branding and onboarding'],
  },
];

export function SubscriptionsPage() {
  const { clients } = useAppState();

  return (
    <div className="subscriptions-page">
      <div className="ph">
        <div>
          <span className="eyebrow">ACCOUNT &amp; PLAN</span>
          <h1>Subscriptions</h1>
          <p>Review the proposed Taxflow plans and the subscription details available for this workspace.</p>
        </div>
      </div>

      <section className="card subscription-current">
        <div className="subscription-current-icon"><Icon name="spark" size={19} /></div>
        <div className="subscription-current-copy">
          <span className="eyebrow">CURRENT WORKSPACE</span>
          <h2>Subscription details aren’t connected yet</h2>
          <p>This workspace has {clients.length} {clients.length === 1 ? 'client' : 'clients'}. There is no active plan, payment method, or renewal date available to manage in the app.</p>
        </div>
        <span className="chip amber">Plan management coming later</span>
      </section>

      <div className="subscription-section-heading">
        <div><h2>Proposed plans</h2><p>Indicative UAE launch pricing from the business-model PRD; not yet available to purchase.</p></div>
        <span className="chip blue">AED · monthly</span>
      </div>

      <div className="subscription-plan-grid">
        {PLANS.map((plan) => (
          <article key={plan.name} className={`card subscription-plan${plan.recommended ? ' recommended' : ''}`}>
            {plan.recommended && <span className="subscription-recommended">MOST FIRMS</span>}
            <div className="subscription-plan-title"><h3>{plan.name}</h3><span>{plan.description}</span></div>
            <div className="subscription-price"><span>AED</span><b>{plan.price}</b><small>/ month</small></div>
            <div className="subscription-plan-limits">
              {plan.limits.map((limit) => <div key={limit}><Icon name="check" size={14} /><span>{limit}</span></div>)}
            </div>
            <div className="subscription-plan-features">
              {plan.features.map((feature) => <div key={feature}><span className="subscription-feature-dot" />{feature}</div>)}
            </div>
            <button type="button" className="btn subscription-unavailable" disabled>Not available yet</button>
          </article>
        ))}
      </div>

      <section className="card subscription-notes">
        <div><Icon name="info" size={16} /><b>Planning prices only</b></div>
        <p>These tiers are proposals to validate with design partners, not confirmed live prices. Usage overages, annual billing, payment processing, and plan changes are not configured. The PRD proposes two months free on annual plans and usage-based charges for extra documents and WhatsApp messages.</p>
      </section>
    </div>
  );
}
