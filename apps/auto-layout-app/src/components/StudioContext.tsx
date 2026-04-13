import { createContext, useContext, ReactNode } from "react";
import type { 
  GeneratedPageLayout, 
  ImageAsset, 
  LayoutAssignment 
} from "@photo-tools/shared-types";

export interface StudioContextValue {
  // Dati di selezione
  activePage: GeneratedPageLayout | null;
  selectedSlot?: GeneratedPageLayout["slotDefinitions"][number];
  selectedAssignment?: LayoutAssignment;
  selectedAsset?: ImageAsset;
  
  // UI State
  isInspectorCollapsed: boolean;
  setIsInspectorCollapsed: (collapsed: boolean) => void;
  cropTarget: { pageId: string; slotId: string } | null;

  // Azioni (Mutation Handlers)
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<Pick<LayoutAssignment, "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight">>
  ) => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onOpenCropEditor: (pageId: string, slotId: string) => void;
  onCloseCropEditor: () => void;
  onPageSheetPresetChange: (pageId: string, presetId: string) => void;
  onPageSheetFieldChange: (
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi" | "photoBorderWidthCm" | "bleedCm",
    value: number
  ) => void;
}

const StudioContext = createContext<StudioContextValue | undefined>(undefined);

export function StudioProvider({ 
  children, 
  value 
}: { 
  children: ReactNode; 
  value: StudioContextValue;
}) {
  return (
    <StudioContext.Provider value={value}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (context === undefined) {
    throw new Error("useStudio must be used within a StudioProvider");
  }
  return context;
}
