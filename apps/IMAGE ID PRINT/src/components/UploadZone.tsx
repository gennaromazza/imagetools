import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '../lib/utils'

interface UploadZoneProps {
  onImageLoaded: (file: File, img: HTMLImageElement) => void
  className?: string
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

export function UploadZone({ onImageLoaded, className }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      onImageLoaded(file, img)
    }
    img.src = url
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
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
        'border-[var(--app-border)] hover:border-[var(--brand-primary)]',
        'bg-[var(--app-field)] hover:bg-[var(--app-field-hover)]',
        'text-[var(--app-text-muted)] select-none',
        className,
      )}
      onDragOver={(e) => e.preventDefault()}
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
