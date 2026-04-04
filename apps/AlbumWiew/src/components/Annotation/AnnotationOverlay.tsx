import React from 'react';

interface AnnotationOverlayProps {
  drawings?: any[];
  onDraw?: (drawing: any) => void;
}

const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({ drawings }) => {
  // Placeholder: qui si può integrare una libreria di disegno (es. react-canvas-draw, fabric.js, ecc.)
  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    }}>
      {/* Renderizza i disegni qui */}
    </div>
  );
};

export default AnnotationOverlay;
