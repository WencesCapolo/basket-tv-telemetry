// next has no exports map and NodeNext only resolves `next/navigation.js`,
// which Turbopack cannot build, so the bare name borrows next's own types.
declare module 'next/navigation' {
  export * from 'next/navigation.js';
}
