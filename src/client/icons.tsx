import React from 'react';
export function Icon({name,size=24}:{name:string;size?:number}){const paths:Record<string,React.ReactNode>={
 parcel:<><path d="m3 7 9-5 9 5v10l-9 5-9-5Z"/><path d="m3 7 9 5 9-5M12 12v10M7.5 4.5l9 5"/></>,
 phone:<path d="M5 3H3v5c0 7.2 5.8 13 13 13h5v-5l-6-2-2 3a13 13 0 0 1-6-6l3-2-2-6Z"/>,
 mic:<><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6"/></>,
 arrow:<path d="M4 12h15M13 6l6 6-6 6"/>, compass:<><circle cx="12" cy="12" r="10"/><path d="m16 8-3 5-5 3 3-5Z"/></>,
 sound:<><path d="m3 9 4 0 5-4v14l-5-4H3Z"/><path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></>,
 mute:<><path d="m3 9 4 0 5-4v14l-5-4H3Z"/><path d="m16 9 6 6m0-6-6 6"/></>,
 check:<path d="m4 12 5 5L20 6"/>, back:<path d="M20 12H5m6-6-6 6 6 6"/>,
 spark:<><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></>,
 sun:<><circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
};return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.spark}</svg>}
