import React from 'react';

interface AlbumPage {
  id: string;
  image: string;
  smartObject?: string;
  notes?: string;
  drawings?: any[];
}

interface AlbumViewerProps {
  pages: AlbumPage[];
  currentPage: number;
  onPageChange: (page: number) => void;
}

const AlbumViewer: React.FC<AlbumViewerProps> = ({ pages, currentPage, onPageChange }) => {
  if (pages.length === 0) return <div>Nessuna pagina caricata.</div>;
  const page = pages[currentPage];
  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <img
          src={page.image}
          alt={`Pagina ${currentPage + 1}`}
          style={{ maxWidth: 600, maxHeight: 400, borderRadius: 8, boxShadow: '0 2px 12px #0002' }}
        />
        {/* Qui si può montare l'overlay per annotazioni/disegni */}
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>
          Pagina precedente
        </button>
        <span style={{ margin: '0 16px' }}>
          Pagina {currentPage + 1} di {pages.length}
        </span>
        <button onClick={() => onPageChange(Math.min(pages.length - 1, currentPage + 1))} disabled={currentPage === pages.length - 1}>
          Pagina successiva
        </button>
      </div>
    </div>
  );
};

export default AlbumViewer;
