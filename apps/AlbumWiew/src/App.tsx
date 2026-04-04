import React, { useState } from 'react';
import { UploadArea, AlternativeUpload } from './components/Upload';
import { AlbumViewer } from './components/AlbumViewer';
import { AlternativePhotos } from './components/AlternativePhotos';
import { parsePsd } from './components/PsdHandler';

interface AlbumPage {
  id: string;
  image: string;
  smartObject?: string;
  notes?: string;
  drawings?: any[];
}

const App: React.FC = () => {
  const [pages, setPages] = useState<AlbumPage[]>([]);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const handleFiles = async (files: FileList) => {
    const arr = Array.from(files);
    for (const file of arr) {
      if (file.name.toLowerCase().endsWith('.psd')) {
        // PSD: parsing e aggiunta pagine/alternative
        const result = await parsePsd(file);
        setPages(result.pages);
        setAlternatives(result.alternatives);
      } else if (file.type.startsWith('image/')) {
        // JPG: aggiunta come pagina o alternativa
        setPages(prev => ([...prev, { id: file.name, image: URL.createObjectURL(file) }]));
      }
    }
  };

  const handleAlternativeFiles = (files: FileList) => {
    const arr = Array.from(files);
    setAlternatives(prev => ([...prev, ...arr.map(f => URL.createObjectURL(f))]));
  };

  const handleSelectAlternative = (img: string) => {
    setPages(prev => prev.map((p, idx) => idx === currentPage ? { ...p, image: img } : p));
  };

  return (
    <div className="app-container">
      <h1>AlbumWiew</h1>
      <p>Benvenuto nell'applicazione desktop per album fotografici sfogliabili con annotazioni, PSD e integrazione Auto-layout.</p>
      <UploadArea onFilesSelected={handleFiles} />
      <AlternativeUpload onFilesSelected={handleAlternativeFiles} />
      <AlbumViewer pages={pages} currentPage={currentPage} onPageChange={setCurrentPage} />
      <AlternativePhotos alternatives={alternatives} onSelect={handleSelectAlternative} />
    </div>
  );
};

export default App;
