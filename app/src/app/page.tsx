import PixelCanvas from '../PixelCanvas';
import Check from '../Check';
import Attack from '../Attack';
import Explorer from '../Explorer';
import Agent from '../Agent';
import { FLOW, STATS } from '../mock';

export default function Home() {
  return (
    <>
      <main id="top">
        <section className="hero">
          <h1>LOOK OUT,<br />BEFORE YOU SIGN.</h1>
          <div className="hero-side">
            <p className="hero-caps">A pre-sign safety check for wallets &amp; AI agents</p>
            <p className="hero-sub">Nobody owns the list, nobody sees your query, and a thousand fresh wallets can’t block a real site.</p>
          </div>
        </section>
        <PixelCanvas variant="wave" height={420} />

        <section className="section intro">
          <p className="big">
            Scam sites live and die in minutes, and the list that warns you is owned by one company that sees what you check.
            Lookout puts the intel on Arkiv, weighs it by reputation, and answers privately.
          </p>
          <div className="stats">
            {STATS.map((s) => (
              <div key={s.value} className="stat">
                <b>{s.value}</b>
                <span>{s.label}</span>
                <span className="mono-label">{s.note}</span>
              </div>
            ))}
          </div>
        </section>

        <Check />
        <Attack />
        <Explorer />
        <Agent />

        <section id="how" className="section">
          <div className="split">
            <div>
              <h2>Six steps from report to ruling.</h2>
              <p className="mono-label">How it works</p>
            </div>
            <ol className="flow">
              {FLOW.map(([title, body], i) => (
                <li key={title}>
                  <span className="mono-label">0{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section closing">
          <h2>Arkiv is the source of truth.</h2>
          <p className="lede-sm">Wipe the servers, rebuild the list from Arkiv, get the same root.</p>
          <a className="btn" href="#check">Try a check</a>
          <p className="tiny">Block, warn or unknown. Never “safe”. Two-server PIR assumes the servers do not collude.</p>
        </section>
      </main>

      <footer>
        <PixelCanvas variant="skyline" height={110} />
        <div className="foot-row mono-label">
          <span>LOOKOUT · ETHGLOBAL MUMBAI 2026</span>
          <span>FOSS · NO TRACKERS · KEYS STAY ON DEVICE</span>
        </div>
      </footer>
    </>
  );
}
