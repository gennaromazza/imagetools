import type { ImageAsset } from "@photo-tools/shared-types";
export declare function launchAutoLayoutFromSelection(input: {
    projectName: string;
    sourceFolderPath: string;
    allAssets: ImageAsset[];
    activeAssetIds: string[];
}): Promise<{
    ok: boolean;
    message: string;
}>;
