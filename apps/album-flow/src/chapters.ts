import type { AlbumProject } from "@photo-tools/shared-types";

export function addChapter(project: AlbumProject, title: string, id: string): AlbumProject {
  if (!title.trim()) throw new Error("Inserisci un nome per il capitolo.");
  if (project.chapters.some(chapter => chapter.id === id)) throw new Error("Identificativo capitolo duplicato.");
  return { ...project, updatedAt: new Date().toISOString(), chapters: [...project.chapters,
    { id, title: title.trim(), labelIds: [], orderedAssetIds: [], source: "manual" }] };
}

export function setChapterMembership(project: AlbumProject, chapterId: string, assetId: string, included: boolean): AlbumProject {
  if (!project.chapters.some(chapter => chapter.id === chapterId)) throw new Error("Capitolo inesistente.");
  const asset = project.assets.find(asset => asset.id === assetId);
  if (!asset) throw new Error("Foto inesistente.");
  return { ...project, updatedAt: new Date().toISOString(), chapters: project.chapters.map(chapter => {
    if (chapter.id !== chapterId) return chapter;
    const ids = chapter.orderedAssetIds.filter(id => id !== assetId);
    if (included) {
      // Repeated assignments keep the existing editorial order.
      if (chapter.orderedAssetIds.includes(assetId)) return chapter;
      ids.push(assetId);
    }
    return { ...chapter, orderedAssetIds: ids };
  }) };
}
