import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../lib/utils'

interface UploadZoneProps {
  onImageLoaded: (file: File, img: HTMLImageElement) => void
  className?: string
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

export function UploadZone({ onImageLoaded, className }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Formato file non supportato', {
        description: 'Usa un file JPG o PNG valido.',
      })
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      onImageLoaded(file, img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      toast.error('Immagine non leggibile', {
        description: 'Il file selezionato sembra corrotto o non compatibile.',
      })
    }
    img.src = url
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-5 rounded-xl border-2 border-dashed cursor-pointer',
        'transition-colors duration-200',
        isDragging
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)]'
          : 'border-[var(--app-border)] hover:border-[var(--brand-primary)] bg-[var(--app-field)] hover:bg-[var(--app-field-hover)]',
        'text-[var(--app-text-muted)] select-none',
        className,
      )}
      onDragEnter={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        setIsDragging(false)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!isDragging) setIsDragging(true)
      }}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-[var(--brand-primary-soft)] flex items-center justify-center">
          <Upload size={28} className="text-[var(--brand-primary)]" />
        </div>
        <div className="text-center">
          <p className="text-base font-medium text-[var(--app-text)]">Trascina la foto qui</p>
          <p className="text-sm mt-1">oppure clicca per selezionare</p>
          <p className="text-xs mt-2 text-[var(--app-text-subtle)]">JPG · JPEG · PNG</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        className="hidden"
        onChange={onChange}
      />
    </div>
  )
}
