import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CheckCircle2, FolderOpen, AlertCircle, FileImage, Loader } from "lucide-react";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { defaultProjectExportSettings, useProject } from "../contexts/ProjectContext";
import { getCustomTemplateBackgroundFiles, getImageFile } from "../contexts/ProjectContext";
import { BatchExportImage, BatchExportResult, openExportFolder, useBatchExport } from "../hooks/useApi";

type ExportFailure = { id: string; error: string };

export default function ExportProgress() {
  const { project } = useProject();
  const { batchExport, loading: exporting, progress: apiProgress, error: exportError } = useBatchExport();
  const exportSettings = project.exportSettings ?? defaultProjectExportSettings;
  const [isComplete, setIsComplete] = useState(false);
  const [exportResult, setExportResult] = useState<BatchExportResult | null>(null);
  const [currentFile, setCurrentFile] = useState(1);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [openFolderError, setOpenFolderError] = useState<string | null>(null);

  const images = Array.isArray(project.images) ? project.images : [];
  const imagesToExport = exportSettings.onlyApproved
    ? images.filter((img) => img.approval === "approved")
    : images;
  const totalFiles = imagesToExport.length;

  useEffect(() => {
    let cancelled = false;

    const startExport = async () => {
      const missingFiles: ExportFailure[] = imagesToExport
        .filter((img) => !getImageFile(img.id))
        .map((img) => ({ id: img.id, error: "File originale non disponibile nella sessione corrente" }));

      const payload: BatchExportImage[] = imagesToExport
        .map((img) => {
          const file = getImageFile(img.id);
          if (!file) {
            return null;
          }

          return {
            id: img.id,
            originalName: img.path,
            orientation: img.orientation,
            file,
            crop: img.crop,
          };
        })
        .filter((img): img is BatchExportImage & { originalName: string } => img !== null);

      if (payload.length === 0) {
        if (!cancelled) {
          setExportResult({
            success: [],
            failed: missingFiles,
            totalTime: 0,
            outputDir: "",
          });
          setIsComplete(true);
        }
        return;
      }

      try {
        const result = await batchExport(payload, project.template, {
          quality: exportSettings.quality,
          format: exportSettings.format,
          colorProfile: exportSettings.colorProfile,
          namingPattern: exportSettings.namingPattern,
          projectName: project.name,
          outputPath: project.outputPath,
          createSubfolder: exportSettings.createSubfolder,
          embedColorProfile: exportSettings.embedColorProfile,
          overwrite: exportSettings.overwrite,
          customTemplate: project.customTemplate,
          customTemplateBackgroundFiles: getCustomTemplateBackgroundFiles(),
        });

        if (cancelled) {
          return;
        }

        setExportResult({
          ...result,
          failed: [...missingFiles, ...result.failed],
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : exportError || "Export failed";
        setExportResult({
          success: [],
          failed: [
            ...missingFiles,
            ...payload.map((img) => ({ id: img.id, error: message })),
          ],
          totalTime: 0,
          outputDir: "",
        });
      }

      setIsComplete(true);
    };

    void startExport();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (totalFiles === 0) {
      setCurrentFile(0);
      return;
    }

    const fileIndex = Math.floor((apiProgress / 100) * totalFiles);
    setCurrentFile(Math.min(Math.max(fileIndex + 1, 1), totalFiles));
  }, [apiProgress, totalFiles]);

  const handleOpenFolder = async () => {
    if (!exportResult?.outputDir) {
      setOpenFolderError("Nessuna cartella output disponibile per questa esportazione.");
      return;
    }

    setOpenFolderError(null);
    setOpeningFolder(true);
    const success = await openExportFolder(exportResult?.outputDir);
    setOpeningFolder(false);

    if (!success) {
      setOpenFolderError("Impossibile aprire la cartella exports del server locale.");
    }
  };

  const totalExportedSizeMb = ((exportResult?.success.reduce((sum, file) => sum + (file.size || 0), 0) || 0) / 1024 / 1024).toFixed(1);

  return (
    <div className="h-screen bg-[#1a1a1a] text-gray-100 flex flex-col">
      <div className="h-14 bg-[#0f0f0f] border-b border-gray-800 flex items-center px-6">
        <div className="flex items-center gap-3">
          <FileImage className="w-6 h-6 text-blue-400" />
          <span className="font-semibold">Esportazione in Corso</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl">
          <div className="bg-[#252525] border border-gray-700 rounded-lg p-8 space-y-8">
            {!isComplete || exporting ? (
              <>
                <h2 className="text-2xl mb-6">Esportazione in Corso...</h2>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">
                      {totalFiles === 0 ? "Nessun file da esportare" : `Elaborazione ${currentFile} di ${totalFiles}`}
                    </span>
                    <span className="text-blue-400 font-bold">{apiProgress}%</span>
                  </div>
                  <Progress value={apiProgress} className="h-3" />
                </div>

                <div className="bg-[#1a1a1a] border border-gray-700 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center animate-pulse">
                      <Loader className="w-5 h-5 animate-spin" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">File In Elaborazione</p>
                      <p className="font-medium">{imagesToExport[currentFile - 1]?.id || "Preparazione export..."}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-medium mb-3">Fasi di Elaborazione:</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-gray-400">Caricamento immagini sorgente</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-gray-400">Applicazione crop e cornice</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                      <span>Rendering output finale {exportSettings.format.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="w-4 h-4 rounded-full border-2 border-gray-600"></div>
                      <span>Scrittura nella cartella exports</span>
                    </div>
                  </div>
                </div>

                {exportError && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                    <div className="flex gap-2">
                      <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-red-400 font-medium">Errore durante l'esportazione</p>
                        <p className="text-red-300 text-sm">{exportError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-center mb-8">
                  <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center">
                      <CheckCircle2 className="w-10 h-10 text-white" />
                    </div>
                  </div>
                  <h2 className="text-2xl mb-2">Esportazione Completata!</h2>
                  <p className="text-gray-400">
                    {exportResult?.success.length || 0} di {totalFiles} immagini esportate con successo
                  </p>
                </div>

                <div className="bg-[#1a1a1a] border border-gray-700 rounded-lg p-6 mb-6">
                  <h3 className="text-sm font-medium mb-4">Riepilogo Esportazione</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">File Riusciti:</span>
                      <span className="text-green-400">{exportResult?.success.length || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Falliti:</span>
                      <span className={exportResult?.failed.length ? "text-red-400" : ""}>{exportResult?.failed.length || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Tempo Trascorso:</span>
                      <span>{Math.round((exportResult?.totalTime || 0) / 1000)} secondi</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Dimensione Totale:</span>
                      <span>{totalExportedSizeMb} MB</span>
                    </div>
                  </div>
                </div>

                {exportResult?.failed.length ? (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                    <div className="flex gap-2 mb-3">
                      <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-400 font-medium">
                        {exportResult.failed.length} file non elaborati
                      </p>
                    </div>
                    <ul className="text-xs text-red-300 space-y-1 ml-7 max-h-32 overflow-auto">
                      {exportResult.failed.map((file) => (
                        <li key={`${file.id}-${file.error}`}>{file.id}: {file.error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {openFolderError ? (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-sm text-red-300">
                    {openFolderError}
                  </div>
                ) : null}

                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    className="flex-1 border-gray-600 hover:bg-[#2a2a2a]"
                    onClick={handleOpenFolder}
                    disabled={openingFolder || !exportResult?.outputDir}
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {openingFolder ? "Apro cartella..." : "Apri Cartella Output"}
                  </Button>
                  <Link to="/">
                    <Button className="flex-1 bg-blue-600 hover:bg-blue-700">Torna alla Home</Button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
