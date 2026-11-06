import type { ReactNode } from 'react';
import PixelCanvas from './PixelCanvas';
import * as P from './pitch-data';

export type Track = 'arkiv' | 'ef';
export interface SlideDef { id: string; render: (active: boolean) => ReactNode; cover?: boolean }

/* ---------- shared building blocks ---------- */

function Title({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="s-head">
      <p className="mono-label">{label}</p>
      <h2 className="s-title">{children}</h2>
    </div>
  );
}

function Rows({ items }: { items: readonly (readonly [string, string, string?])[] }) {
  return (
    <ul className="mrows">
      {items.map(([k, v, tag]) => (
        <li key={k}>
          <h3>{k}{tag && <span className="tag">{tag}</span>}</h3>
          <p>{v}</p>
        </li>
      ))}
    </ul>
  );
}

function Cover({ label, title, lede, active, wave }: { label: string; title: string[]; lede: string; active: boolean; wave: 'wave' | 'skyline' }) {
  return (
    <>
      <div className="cover-text">
        <p className="mono-label">{label}</p>
        <h1>{title.map((t, i) => <span key={t}>{t}{i < title.length - 1 && <br />}</span>)}</h1>
        <p className="s-lede">{lede}</p>
      </div>
      {active && <div className="cover-canvas"><PixelCanvas variant={wave} height={190} /></div>}
    </>
  );
}

function ProblemSlide({ title, problems }: { title: string; problems: P.Pair[] }) {
  return (
    <>
      <Title label="01 · Problem">{title}</Title>
      <div className="cols2">
        <Rows items={problems} />
        <div className="statcol">
          {P.SCALE.map(([v, l, s]) => (
            <div key={l}><b>{v}</b><span>{l}</span><span className="mono-label">{s}</span></div>
          ))}
          <p className="foot-note">Re-verify these figures against their sources before presenting.</p>
        </div>
      </div>
    </>
  );
}

function WorkflowSlide({ intro, steps, notes }: { intro: string; steps: P.Step[]; notes: string[] }) {
  return (
    <>
      <Title label="02 · Solution">Introducing Lookout.</Title>
      <p className="intro-box">{intro}</p>
      <div className="workflow" aria-label="Lookout workflow">
        {steps.map(([title, caption, track, tag], n) => (
          <div key={title} className="wf-step">
            <div className={`wf-node ${track ? `t-${track}` : ''}`}>
              <span className="mono-label">0{n + 1}</span>
              <h3>{title}</h3>
              <p>{caption}</p>
              {track && <span className="tag">{tag ?? P.TRACK_LABEL[track]}</span>}
            </div>
            {n < steps.length - 1 && <span className="wf-arrow" aria-hidden="true">→</span>}
          </div>
        ))}
      </div>
      <div className="wf-notes">
        {notes.map((t) => <p key={t}>{t}</p>)}
      </div>
      <div className="trio">
        <div className="verdict-tile v-block"><b>BLOCK</b><span>Earned, never counted</span></div>
        <div className="verdict-tile v-warn"><b>WARN</b><span>Low reputation or disputed</span></div>
        <div className="verdict-tile v-unknown"><b>UNKNOWN</b><span>Never “safe”</span></div>
      </div>
    </>
  );
}

function Banner({ line, sub, small }: { line: string; sub: string; small: string }) {
  return (
    <div className="banner">
      <p><span>{line}</span> {sub}</p>
      <span className="mono-label">{small}</span>
    </div>
  );
}

/* ---------- ARKIV deck ---------- */

const A = P.ARKIV;

const ARKIV_SLIDES: SlideDef[] = [
  {
    id: 'a-cover', cover: true,
    render: (active) => <Cover {...A.cover} active={active} wave="wave" />,
  },
  { id: 'a-problem', render: () => <ProblemSlide title={A.problemTitle} problems={A.problems} /> },
  {
    id: 'a-workflow',
    render: () => <WorkflowSlide intro={A.intro} steps={A.workflow} notes={A.notes} />,
  },
  {
    id: 'a-model',
    render: () => (
      <>
        <Title label="03 · Arkiv data model">{A.modelTitle}</Title>
        <div className="cols2">
          <table className="ent-table slide-table">
            <thead><tr><th>Entity</th><th>Holds</th><th>Owner</th><th>Expiry</th></tr></thead>
            <tbody>
              {A.entities.map(([e, h, o, x]) => (
                <tr key={e}><td><span className={`kind k-${e}`}>{e}</span></td><td>{h}</td><td>{o}</td><td>{x}</td></tr>
              ))}
            </tbody>
          </table>
          <div>
            <p className="mono-label">Why Arkiv</p>
            <Rows items={A.why} />
            <p className="foot-note">{A.notOnArkiv}</p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'a-trust',
    render: () => (
      <>
        <Title label="04 · Trust and feedback">{A.trustTitle}</Title>
        <div className="cols2 even">
          <div className="panel-s">
            <p className="mono-label">Anti-Sybil · a thousand fake wallets weigh zero</p>
            <div className="equation">
              <div><b>1,000</b><span className="mono-label">fresh wallets</span></div>
              <i>×</i>
              <div><b>0</b><span className="mono-label">weight</span></div>
              <i>=</i>
              <div className="eq-res"><b>0</b><span className="mono-label">still a warning</span></div>
            </div>
            <Rows items={P.SYBIL} />
          </div>
          <div className="panel-s">
            <p className="mono-label">{A.feedbackLabel}</p>
            <Rows items={A.feedback} />
          </div>
        </div>
        <Banner line={A.line} sub={A.lineSub} small={A.limits} />
      </>
    ),
  },
];

/* ---------- EF deck ---------- */

const E = P.EF;

const EF_SLIDES: SlideDef[] = [
  {
    id: 'e-cover', cover: true,
    render: (active) => <Cover {...E.cover} active={active} wave="wave" />,
  },
  { id: 'e-problem', render: () => <ProblemSlide title={E.problemTitle} problems={E.problems} /> },
  {
    id: 'e-workflow',
    render: () => <WorkflowSlide intro={E.intro} steps={E.workflow} notes={E.notes} />,
  },
  {
    id: 'e-crops',
    render: () => (
      <>
        <Title label="03 · CROPS">{E.cropsTitle}</Title>
        <div className="cols2 even">
          <div>
            <p className="mono-label">CROPS, one line each</p>
            <Rows items={E.crops} />
          </div>
          <div>
            <p className="mono-label">What each party can see</p>
            <Rows items={E.sees} />
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'e-stack',
    render: () => (
      <>
        <Title label="04 · Privacy stack">{E.stackTitle}</Title>
        <div className="cols2 even">
          <div>
            <p className="mono-label">The privacy stack, including Anon-RPC</p>
            <Rows items={E.stack} />
          </div>
          <div>
            <p className="mono-label">In the 3-minute demo</p>
            <Rows items={E.demo} />
          </div>
        </div>
        <Banner line={E.line} sub={E.lineSub} small={E.limits} />
      </>
    ),
  },
];

export const SLIDE_SETS: Record<Track, { name: string; slides: SlideDef[] }> = {
  arkiv: { name: 'LOOKOUT · ARKIV', slides: ARKIV_SLIDES },
  ef: { name: 'LOOKOUT · EF', slides: EF_SLIDES },
};
