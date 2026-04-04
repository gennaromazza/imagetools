// Placeholder per la gestione PSD lato frontend o tramite bridge Electron
// In futuro qui si potrà integrare ag-psd, psd.js o chiamate a processi Node/Electron
export function parsePsd(file: File): Promise<any> {
  // TODO: implementare parsing PSD
  return Promise.resolve({ pages: [], alternatives: [] });
}
