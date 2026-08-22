interface LandingPageProps {
  onLaunch: () => void;
}

const STATS = [
  { value: '42,000', label: 'mUSD funded',                highlight: false },
  { value: '10%',    label: 'avg. investor yield',         highlight: true  },
  { value: '3',      label: 'claim types supported',       highlight: false },
  { value: '2-of-3', label: 'multisig dispute resolution', highlight: false },
] as const;

const STEPS = [
  {
    chip: '01', color: 'violet' as const,
    title: 'List your claim',
    body: 'Tokenize an invoice, royalty stream or rental income and post collateral.',
  },
  {
    chip: '02', color: 'teal' as const,
    title: 'Get funded instantly',
    body: 'An on-chain risk score sets your terms. Investors fund you directly, same day.',
  },
  {
    chip: '03', color: 'amber' as const,
    title: 'Repay and settle',
    body: 'Repay principal plus yield. Disputes are resolved by an on-chain arbitrator quorum.',
  },
] as const;

export default function LandingPage({ onLaunch }: LandingPageProps) {
  return (
    <main className="vf-landing">
      {/* Hero */}
      <section className="vf-landing-hero">
        <span className="vf-landing-badge">
          <span className="vf-landing-badge-dot" aria-hidden="true" />
          Live on BOT Chain mainnet
        </span>
        <h1>Unlock capital from what<br />you're already owed</h1>
        <p className="vf-landing-summary">
          Businesses, artists and landlords turn invoices, royalties and rent into funded capital today.
          Investors earn transparent, collateral-backed yield.
        </p>
        <div className="vf-landing-actions">
          <button className="vf-btn vf-btn-primary" onClick={onLaunch}>Launch app</button>
          <a href="#how" className="vf-btn vf-btn-ghost">How it works</a>
        </div>
      </section>

      {/* Stats strip */}
      <div className="vf-landing-stats">
        {STATS.map((stat) => (
          <div key={stat.label} className="vf-card vf-landing-stat-card">
            <strong className={`vf-landing-stat-value${stat.highlight ? ' vf-landing-stat-highlight' : ''}`}>
              {stat.value}
            </strong>
            <span className="vf-landing-stat-label">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* How it works */}
      <section className="vf-landing-how" id="how">
        <p className="vf-landing-how-label">How CredFi Works</p>
        <div className="vf-landing-steps">
          {STEPS.map((step) => (
            <article key={step.title} className="vf-landing-step">
              <span className={`vf-step-chip vf-step-chip--${step.color}`}>{step.chip}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
