import { Link, useNavigate } from "react-router";
import { ArrowLeft, Download, FileImage, FolderOpen } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Slider } from "../components/ui/slider";
import { useState } from "react";
import { defaultProjectExportSettings, useProject } from "../contexts/ProjectContext";
import { pickExportFolder } from "../hooks/useApi";

export default function ExportSettings() {
  const navigate = useNavigate();
  const { project, updateExportSettings, updateOutputPath } = useProject();
  const exportSettings = project.exportSettings ?? defaultProjectExportSettings;
  const [quality, setQuality] = useState([exportSettings.quality]);
  const [format, setFormat] = useState(exportSettings.format);
  const [colorProfile, setColorProfile] = useState(exportSettings.colorProfile);
  const [namingPattern, setNamingPattern] = useState(exportSettings.namingPattern);
  const [onlyApproved, setOnlyApproved] = useState(exportSettings.onlyApproved);
  const [embedColorProfile, setEmbedColorProfile] = useState(exportSettings.embedColorProfile);
  const [createSubfolder, setCreateSubfolder] = useState(exportSettings.createSubfolder);
  const [outputPath, setOutputPath] = useState(project.outputPath);
  const [pickingFolder, setPickingFolder] = useState(false);

  const images = Array.isArray(project.images) ? project.images : [];
  const approvedImages = images.filter((img) => img.approval === "approved");
  const imagesToExportCount = onlyApproved ? approvedImages.length : images.length;

  const handleStartExport = () => {
    updateOutputPath(outputPath.trim());
    updateExportSettings({
      quality: quality[0],
      format,
      colorProfile,
      namingPattern,
      onlyApproved,
      embedColorProfile,
      createSubfolder,
    });

    navigate("/export-progress");
  };

  const handleBrowseOutputFolder = async () => {
    setPickingFolder(true);
    const selectedPath = await pickExportFolder(outputPath);
    setPickingFolder(false);

    if (selectedPath) {
      setOutputPath(selectedPath);
    }
  };

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <Link to="/workspace">
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Torna all'Area di Lavoro
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <FileImage className="w-6 h-6 text-[var(--brand-accent)]" />
            <span className="font-semibold">Impostazioni Esportazione</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center p-8">
        <div className="w-full max-w-3xl">
          <div className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] p-8 shadow-[0_24px_60px_rgba(0,0,0,0.18)]">
            <h2 className="text-2xl mb-6">Configura Esportazione</h2>

            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="format">Formato Output</Label>
                <Select value={format} onValueChange={(value) => setFormat(value as "jpeg" | "png")}>
                  <SelectTrigger className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--app-surface)] border-[var(--app-border)] text-[var(--app-text)]">
                    <SelectItem value="jpeg">JPEG (Alta Qualita)</SelectItem>
                    <SelectItem value="png">PNG (Senza Perdita)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label>Qualita JPEG</Label>
                <div className="flex items-center gap-4">
                  <Slider
                    value={quality}
                    onValueChange={setQuality}
                    min={60}
                    max={100}
                    step={5}
                    className="flex-1"
                    disabled={format === "png"}
                  />
                  <span className="text-sm w-12 text-right">{quality[0]}%</span>
                </div>
                <p className="text-xs text-[var(--app-text-muted)]">
                  {format === "png"
                    ? "PNG esporta senza perdita: il cursore qualita non viene usato."
                    : "Qualita superiore produce file piu grandi (consigliato: 90-100% per la stampa)."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="color-profile">Profilo Colore</Label>
                <Select value={colorProfile} onValueChange={(value) => setColorProfile(value as "sRGB" | "AdobeRGB")}>
                  <SelectTrigger className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--app-surface)] border-[var(--app-border)] text-[var(--app-text)]">
                    <SelectItem value="sRGB">sRGB (Standard)</SelectItem>
                    <SelectItem value="AdobeRGB">Adobe RGB (Ampia Gamma)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filename-pattern">Schema Nome File</Label>
                <Input
                  id="filename-pattern"
                  placeholder="es. {originale}_incorniciato"
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                  value={namingPattern}
                  onChange={(e) => setNamingPattern(e.target.value)}
                />
                <p className="text-xs text-[var(--app-text-muted)]">
                  Variabili disponibili: {"{originale}"}, {"{progetto}"}, {"{contatore}"}, {"{data}"}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Cartella di Destinazione</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="es. D:\\SALVO\\Exports\\Evento"
                    className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)] shrink-0"
                    onClick={handleBrowseOutputFolder}
                    disabled={pickingFolder}
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {pickingFolder ? "Apro..." : "Sfoglia"}
                  </Button>
                </div>
                <p className="text-xs text-[var(--app-text-subtle)]">
                  Se lasci vuoto, il server usera la cartella `exports` del progetto. Se inserisci un path assoluto valido, l'export andra li.
                </p>
              </div>

              <div className="border border-[var(--app-border)] rounded-2xl p-4 bg-[var(--app-field)] space-y-2">
                <h3 className="text-sm font-medium mb-3">Riepilogo Esportazione</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--app-text-muted)]">Totale Immagini:</span>
                      <span>{images.length} file</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-text-muted)]">Immagini da esportare:</span>
                    <span className={imagesToExportCount > 0 ? "text-[var(--success)]" : "text-[var(--brand-accent)]"}>
                      {imagesToExportCount} file
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-text-muted)]">Qualita:</span>
                    <span>{format === "png" ? "Lossless" : `${quality[0]}%`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-text-muted)]">Formato:</span>
                    <span>{format.toUpperCase()}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Opzioni Esportazione</Label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyApproved}
                      onChange={(e) => setOnlyApproved(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--app-border)] bg-[var(--app-field)]"
                    />
                    <span className="text-sm">Esporta solo immagini approvate</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={embedColorProfile}
                      onChange={(e) => setEmbedColorProfile(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--app-border)] bg-[var(--app-field)]"
                    />
                    <span className="text-sm">Incorpora profilo colore nelle immagini esportate</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createSubfolder}
                      onChange={(e) => setCreateSubfolder(e.target.checked)}
                      className="w-4 h-4 rounded border-[var(--app-border)] bg-[var(--app-field)]"
                    />
                    <span className="text-sm">Crea sottocartella per questa esportazione</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-4 mt-8 justify-end">
              <Link to="/workspace">
                <Button variant="outline" className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]">
                  Annulla
                </Button>
              </Link>
              <Button onClick={handleStartExport} size="lg" className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]" disabled={imagesToExportCount === 0}>
                <Download className="w-5 h-5 mr-2" />
                Avvia Esportazione
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
