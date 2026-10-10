import React from 'react';

/** The laboratory's own wordmark, palette and typeface: https://jslab.pink/ */
export function MakerCredit() {
 return <a className="maker-credit" href="https://jslab.pink/?lang=en" target="_blank" rel="noreferrer" aria-label="Made by Japanese Sausage Laboratory — visit the laboratory">
  <svg className="lab-stamp" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="#f1eedf" stroke="currentColor" strokeWidth="1.8"/><text x="20" y="24" textAnchor="middle" textLength="25" lengthAdjust="spacingAndGlyphs" fill="currentColor" fontFamily="Georgia,serif" fontSize="11" fontWeight="bold">J·S·L</text></svg>
  <span className="maker-by">Made by</span>
  <span className="lab-name">Japanese <em>Sausage</em> Laboratory</span>
  <span className="credit-arrow" aria-hidden="true">↗</span>
 </a>;
}

export function EventCredit() {
 return <div className="event-credit" aria-label="Built for Barcelona AI Hackathon">
  <div className="event-dedication"><span>BUILT FOR</span><small>9–10 OCT 2026</small></div>
  <a className="hackathon-wordmark" href="https://luma.com/m0byiqzd" target="_blank" rel="noreferrer" aria-label="Barcelona AI Hackathon — official event">
   <span>BARCELONA {'{AI}'}</span>
   <span>/// HACKATHON <i aria-hidden="true">↗</i></span>
  </a>
 </div>;
}
