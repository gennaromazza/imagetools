import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
export interface XmpState {
    rating?: number;
    pickStatus?: PickStatus;
    colorLabel?: ColorLabel | null;
    selected?: boolean;
    hasCameraRawAdjustments: boolean;
    hasPhotoshopAdjustments: boolean;
}
export declare function parseXmpState(xml: string): XmpState;
export declare function upsertXmpState(existingXml: string | null, asset: ImageAsset, selected: boolean): string;
