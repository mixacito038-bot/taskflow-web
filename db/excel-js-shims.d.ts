// The maintained JSZip fork's current exports map does not expose declarations
// to TypeScript's bundler resolver. Runtime APIs are narrowed structurally in
// data-workbench-xlsx.ts until the package export is corrected upstream.
declare module "@excel.js/jszip" {
  const JSZip: unknown;
  export default JSZip;
}
