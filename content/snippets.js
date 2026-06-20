// snippets.js -- utility helpers

export const debounce   = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const throttle   = (fn, ms) => { let l = 0; return (...a) => { const n = Date.now(); if (n - l >= ms) { l = n; return fn(...a); } }; };
export const deepClone  = (o) => JSON.parse(JSON.stringify(o));
export const capitalize = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
export const sleep      = (ms) => new Promise(r => setTimeout(r, ms));
export const groupBy    = (arr, key) => arr.reduce((a, i) => { (a[i[key]] = a[i[key]] || []).push(i); return a; }, {});
export const randomHex  = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
export const parseQuery = (qs) => Object.fromEntries(new URLSearchParams(qs));
