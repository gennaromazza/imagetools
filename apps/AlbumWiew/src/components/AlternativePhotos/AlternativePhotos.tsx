import React from 'react';

interface AlternativePhotosProps {
  alternatives: string[];
  onSelect: (img: string) => void;
}

const AlternativePhotos: React.FC<AlternativePhotosProps> = ({ alternatives, onSelect }) => {
  if (!alternatives.length) return null;
  return (
    <div style={{ margin: '24px 0' }}>
      <h3>Altre foto disponibili</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {alternatives.map((img, idx) => (
          <img
            key={idx}
            src={img}
            alt={`Alternativa ${idx + 1}`}
            style={{ width: 100, height: 70, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid #eee' }}
            onClick={() => onSelect(img)}
          />
        ))}
      </div>
    </div>
  );
};

export default AlternativePhotos;
