import type { ReactNode } from 'react';
import PixelCanvas from './PixelCanvas';
import * as P from './pitch-data';
import { WORLDID } from './pitch-worldid';

export type Track = 'arkiv' | 'worldid';
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

/* ---------- WORLD ID deck ---------- */

const W = WORLDID;

const WORLD_SLIDES: SlideDef[] = [
  {
    id: 'w-cover', cover: true,
    render: (active) => <Cover {...W.cover} active={active} wave="wave" />,
  },
  {
    id: 'w-trust',
    render: () => (
      <>
        <Title label="01 · The trust moment">{W.trustTitle}</Title>
        <div className="cols2">
          <Rows items={W.trust} />
          <div className="vs">
            <div className="vs-card vs-bad"><span className="mono-label">{W.without[0]}</span><p>{W.without[1]}</p></div>
            <div className="vs-card vs-good"><span className="mono-label">{W.with[0]}</span><p>{W.with[1]}</p></div>
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'w-choice',
    render: () => (
      <>
        <Title label="02 · Which credential">{W.choiceTitle}</Title>
        <table className="ent-table slide-table choice">
          <thead><tr><th>Credential</th><th>What it proves</th><th>Here</th><th>Why</th></tr></thead>
          <tbody>
            {W.choices.map(([name, proves, verdict, why]) => (
              <tr key={name} className={verdict === 'Chosen' ? 'chosen' : ''}>
                <td><b>{name}</b></td>
                <td>{proves}</td>
                <td><span className={`kind ${verdict === 'Chosen' ? 'k-attestation' : ''}`}>{verdict}</span></td>
                <td className="dim">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'w-flow',
    render: () => (
      <>
        <Title label="03 · The flow">{W.flowTitle}</Title>
        <div className="workflow" aria-label="Human verification flow">
          {W.flow.map(([title, caption], n) => (
            <div key={title} className="wf-step">
              <div className={`wf-node ${n === 2 ? 't-ef' : ''}`}>
                <span className="mono-label">0{n + 1}</span>
                <h3>{title}</h3>
                <p>{caption}</p>
                {n === 2 && <span className="tag">World ID</span>}
              </div>
              {n < W.flow.length - 1 && <span className="wf-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
        <div className="trio">
          {W.outcomes.map(([title, body, tone]) => (
            <div key={title} className={`verdict-tile o-${tone}`}><b>{title}</b><span>{body}</span></div>
          ))}
        </div>
      </>
    ),
  },
  {
    id: 'w-status',
    render: () => (
      <>
        <Title label="04 · Debrief and status">{W.statusTitle}</Title>
        <div className="cols2 even">
          <div>
            <p className="mono-label">{W.debriefLabel}</p>
            <Rows items={W.debrief} />
          </div>
          <div>
            <p className="mono-label">{W.statusLabel}</p>
            <Rows items={W.status} />
          </div>
        </div>
        <Banner line={W.line} sub={W.lineSub} small={W.limits} />
      </>
    ),
  },
];

export const SLIDE_SETS: Record<Track, { name: string; slides: SlideDef[] }> = {
  arkiv: { name: 'LOOKOUT · ARKIV', slides: ARKIV_SLIDES },
  worldid: { name: 'LOOKOUT · WORLD ID', slides: WORLD_SLIDES },
};
