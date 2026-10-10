import React, { useEffect, useRef } from 'react';
import { Icon } from './icons';
import { MakerCredit, EventCredit } from './Credits';
import './qr-dialog.css';

export function QrDialog({ onClose }: { onClose: () => void }) {
 const dialog = useRef<HTMLDialogElement>(null);
 const closeCallback = useRef(onClose);
 closeCallback.current = onClose;
 useEffect(() => {
  const element = dialog.current!;
  element.showModal();
  return () => { if (element.open) element.close(); };
 }, []);
 const close = () => dialog.current?.close();
 return <dialog ref={dialog} className="qr-dialog" aria-labelledby="qr-dialog-title"
  aria-describedby="qr-dialog-description" onClose={event => {
   // StrictMode may queue cleanup's close event after the next effect reopens it.
   if (!event.currentTarget.open) closeCallback.current();
  }}
  onCancel={event => { event.preventDefault(); close(); }}
  onClick={event => {
   if (event.target !== event.currentTarget) return;
   const bounds = event.currentTarget.getBoundingClientRect();
   if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }}>
  <div className="qr-dialog-content">
   <div className="qr-dialog-top">
    <div className="qr-dialog-brand"><span className="qr-dialog-compass"><Icon name="compass" size={28}/></span><span>Expatia <span className="qr-dialog-world">World</span></span></div>
    <button type="button" className="qr-dialog-close" onClick={close} aria-label="Close QR code" autoFocus><span aria-hidden="true">×</span></button>
   </div>
   <div className="qr-dialog-heading">
    <h2 id="qr-dialog-title">Your next little win<br/>starts here.</h2>
    <p id="qr-dialog-description">Scan to try Expatia World on your phone.</p>
   </div>
   <a className="qr-dialog-scan" href="https://expatia.world" target="_blank" rel="noreferrer" aria-label="Open Expatia World">
    <img src="/art/site-qr.svg" width="300" height="300" alt="QR code for https://expatia.world"/>
   </a>
   <a className="qr-dialog-address" href="https://expatia.world" target="_blank" rel="noreferrer">expatia.world <span aria-hidden="true">↗</span></a>
   <a className="qr-dialog-page" href="/qr.html" target="_blank" rel="noreferrer">Open QR page <span aria-hidden="true">↗</span></a>
   <div className="qr-dialog-credits"><EventCredit/><MakerCredit/></div>
  </div>
 </dialog>;
}
