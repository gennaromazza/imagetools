import type { ImageAsset } from "@photo-tools/shared-types";

const sampleUrls = [
  "/demo-thumbs/DSC08050.jpg",
  "/demo-thumbs/DSC08055.jpg",
  "/demo-thumbs/DSC08062.jpg",
  "/demo-thumbs/DSC08068.jpg",
  "/demo-thumbs/DSC08073.jpg",
  "/demo-thumbs/DSC08089.jpg",
  "/demo-thumbs/DSC08093.jpg",
  "/demo-thumbs/DSC08104.jpg",
  "/demo-thumbs/DSC08115.jpg",
  "/demo-thumbs/DSC08120.jpg",
  "/demo-thumbs/DSC08138.jpg",
  "/demo-thumbs/DSC08142.jpg"
];

const baseAssets: Omit<ImageAsset, "thumbnailUrl" | "previewUrl" | "sourceUrl">[] = [
  { id: "img-001", fileName: "DSC08050.jpg", path: "demo/DSC08050.jpg", width: 3024, height: 4032, orientation: "vertical", aspectRatio: 0.75 },
  { id: "img-002", fileName: "DSC08055.jpg", path: "demo/DSC08055.jpg", width: 3024, height: 4032, orientation: "vertical", aspectRatio: 0.75 },
  { id: "img-003", fileName: "DSC08062.jpg", path: "demo/DSC08062.jpg", width: 4288, height: 2848, orientation: "horizontal", aspectRatio: 1.5056 },
  { id: "img-004", fileName: "DSC08068.jpg", path: "demo/DSC08068.jpg", width: 4288, height: 2848, orientation: "horizontal", aspectRatio: 1.5056 },
  { id: "img-005", fileName: "DSC08073.jpg", path: "demo/DSC08073.jpg", width: 3200, height: 4800, orientation: "vertical", aspectRatio: 0.6667 },
  { id: "img-006", fileName: "DSC08089.jpg", path: "demo/DSC08089.jpg", width: 3200, height: 3200, orientation: "square", aspectRatio: 1 },
  { id: "img-007", fileName: "DSC08093.jpg", path: "demo/DSC08093.jpg", width: 4200, height: 2800, orientation: "horizontal", aspectRatio: 1.5 },
  { id: "img-008", fileName: "DSC08104.jpg", path: "demo/DSC08104.jpg", width: 3000, height: 4500, orientation: "vertical", aspectRatio: 0.6667 },
  { id: "img-009", fileName: "DSC08115.jpg", path: "demo/DSC08115.jpg", width: 4200, height: 2800, orientation: "horizontal", aspectRatio: 1.5 },
  { id: "img-010", fileName: "DSC08120.jpg", path: "demo/DSC08120.jpg", width: 4200, height: 2800, orientation: "horizontal", aspectRatio: 1.5 },
  { id: "img-011", fileName: "DSC08138.jpg", path: "demo/DSC08138.jpg", width: 2800, height: 2800, orientation: "square", aspectRatio: 1 },
  { id: "img-012", fileName: "DSC08142.jpg", path: "demo/DSC08142.jpg", width: 3000, height: 4500, orientation: "vertical", aspectRatio: 0.6667 }
];

export const mockWeddingAssets: ImageAsset[] = baseAssets.map((asset, index) => ({
  ...asset,
  thumbnailUrl: sampleUrls[index],
  previewUrl: sampleUrls[index],
  sourceUrl: sampleUrls[index]
}));
