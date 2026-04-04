import React, { useRef } from 'react';

interface UploadAreaProps {
  onFilesSelected: (files: FileList) => void;
}

const UploadArea: React.FC<UploadAreaProps> = ({ onFilesSelected }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onClick={handleClick}
      style={{
        border: '2px dashed #888',
        borderRadius: 8,
        padding: 32,
        textAlign: 'center',
        cursor: 'pointer',
        background: '#fafbfc',
        marginBottom: 24
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.psd"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <p>Trascina qui i file JPG o PSD, oppure <b>sfoglia</b></p>
    </div>
  );
};

export default UploadArea;
