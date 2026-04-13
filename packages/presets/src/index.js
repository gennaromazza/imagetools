export const SHEET_PRESETS = [
    { id: "13x18", label: "13x18 cm", widthCm: 13, heightCm: 18 },
    { id: "15x20", label: "15x20 cm", widthCm: 15, heightCm: 20 },
    { id: "20x15", label: "20x15 cm", widthCm: 20, heightCm: 15 },
    { id: "20x30", label: "20x30 cm", widthCm: 20, heightCm: 30 },
    { id: "30x20", label: "30x20 cm", widthCm: 30, heightCm: 20 },
    { id: "a4", label: "A4", widthCm: 21, heightCm: 29.7 },
    { id: "custom", label: "Personalizzato", widthCm: 15, heightCm: 20 }
];
export const DEFAULT_SHEET_SPEC = {
    presetId: "15x20",
    label: "15x20 cm",
    widthCm: 15,
    heightCm: 20,
    dpi: 300,
    marginCm: 1,
    gapCm: 0.4,
    backgroundColor: "#ffffff",
    backgroundImageUrl: "",
    photoBorderColor: "#ffffff",
    photoBorderWidthCm: 0,
    showRulers: false,
    rulerUnit: "cm",
    verticalGuidesCm: [],
    horizontalGuidesCm: []
};
export const DEFAULT_AUTO_LAYOUT_REQUEST = {
    jobName: "wedding-service-layout",
    sourceFolderPath: "C:/jobs/wedding-2026/selected",
    workflowMode: "auto",
    sheet: DEFAULT_SHEET_SPEC,
    fitMode: "fit",
    cropStrategy: "balanced",
    planningMode: "desiredSheetCount",
    desiredSheetCount: 8,
    output: {
        folderPath: "exports/auto-layout",
        format: "jpg",
        fileNamePattern: "wedding-layout-{index}",
        quality: 100
    },
    allowTemplateVariation: true
};
//# sourceMappingURL=index.js.map