// Turbopack fails on `next/navigation.js`, and NodeNext only resolves that
// form (next has no exports map), so the bare names borrow next's own types.
declare module 'next/headers' {
  export * from 'next/headers.js';
}
declare module 'next/navigation' {
  export * from 'next/navigation.js';
}
