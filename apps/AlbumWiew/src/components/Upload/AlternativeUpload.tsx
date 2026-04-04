import React, { useRef } from 'react';

interface AlternativeUploadProps {
  onFilesSelected: (files: FileList) => void;
}

const AlternativeUpload: React.FC<AlternativeUploadProps> = ({ onFilesSelected }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={handleClick}>Aggiungi foto alternative</button>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  );
};

export default AlternativeUpload;
