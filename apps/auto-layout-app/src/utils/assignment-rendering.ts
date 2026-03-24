import type { LayoutAssignment } from "@photo-tools/shared-types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRotation(value: number): number {
  const rounded = Math.round(value);
  const wrapped = ((rounded % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

export function getRotatedBoundingAspect(aspect: number, rotation: number): number {
  const radians = (Math.abs(normalizeRotation(rotation)) * Math.PI) / 180;
  const width = Math.max(aspect, 0.001);
  const height = 1;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidth = width * cos + height * sin;
  const rotatedHeight = width * sin + height * cos;
  return rotatedWidth / Math.max(rotatedHeight, 0.001);
}

export function getNormalizedAssignmentCrop(assignment: LayoutAssignment) {
  const cropLeft = clamp(assignment.cropLeft ?? 0, 0, 1);
  const cropTop = clamp(assignment.cropTop ?? 0, 0, 1);
  const cropWidth = clamp(assignment.cropWidth ?? 1, 0.05, 1);
  const cropHeight = clamp(assignment.cropHeight ?? 1, 0.05, 1);

  return { cropLeft, cropTop, cropWidth, cropHeight };
}

export function getAssignmentViewportGeometry(
  assignment: LayoutAssignment,
  imageAspect: number,
  slotAspect: number
) {
  const { cropLeft, cropTop, cropWidth, cropHeight } = getNormalizedAssignmentCrop(assignment);
  const cropAspect = (Math.max(imageAspect, 0.001) * cropWidth) / Math.max(cropHeight, 0.001);
  const visibleAspect = getRotatedBoundingAspect(cropAspect, assignment.rotation ?? 0);
  const zoom = Math.max(0.4, assignment.zoom);
  const fitMode = assignment.fitMode === "fit" ? "fit" : "fill";

  let frameWidthPercent = 100;
  let frameHeightPercent = 100;

  if (fitMode === "fit") {
    if (visibleAspect > slotAspect) {
      frameHeightPercent = (slotAspect / Math.max(visibleAspect, 0.001)) * 100;
    } else {
      frameWidthPercent = (visibleAspect / Math.max(slotAspect, 0.001)) * 100;
    }
  } else if (visibleAspect > slotAspect) {
    frameWidthPercent = (visibleAspect / Math.max(slotAspect, 0.001)) * 100;
  } else {
    frameHeightPercent = (slotAspect / Math.max(visibleAspect, 0.001)) * 100;
  }

  frameWidthPercent *= zoom;
  frameHeightPercent *= zoom;

  const overflowXPercent = Math.max(0, frameWidthPercent - 100);
  const overflowYPercent = Math.max(0, frameHeightPercent - 100);
  const offsetXPercent = (assignment.offsetX / 100) * (overflowXPercent / 2);
  const offsetYPercent = (assignment.offsetY / 100) * (overflowYPercent / 2);

  return {
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight,
    cropAspect,
    visibleAspect,
    frameWidthPercent,
    frameHeightPercent,
    offsetXPercent,
    offsetYPercent,
    imageWidthPercent: 100 / cropWidth,
    imageHeightPercent: 100 / cropHeight,
    imageLeftPercent: (-cropLeft / cropWidth) * 100,
    imageTopPercent: (-cropTop / cropHeight) * 100,
    rotationDeg: assignment.rotation ?? 0
  };
}

export function getAssignmentCanvasDrawMetrics(
  assignment: LayoutAssignment,
  imageAspect: number,
  slotWidth: number,
  slotHeight: number
) {
  const slotAspect = Math.max(slotWidth, 1) / Math.max(slotHeight, 1);
  const geometry = getAssignmentViewportGeometry(assignment, imageAspect, slotAspect);

  return {
    ...geometry,
    drawWidth: (geometry.frameWidthPercent / 100) * slotWidth,
    drawHeight: (geometry.frameHeightPercent / 100) * slotHeight,
    translateX: (geometry.offsetXPercent / 100) * slotWidth,
    translateY: (geometry.offsetYPercent / 100) * slotHeight,
    rotationRad: (geometry.rotationDeg * Math.PI) / 180
  };
}

type Point = { x: number; y: number };

function rotatePoint(point: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
}

function intersectVertical(start: Point, end: Point, x: number): Point {
  const dx = end.x - start.x;
  if (Math.abs(dx) < 1e-6) {
    return { x, y: start.y };
  }
  const t = (x - start.x) / dx;
  return {
    x,
    y: start.y + (end.y - start.y) * t
  };
}

function intersectHorizontal(start: Point, end: Point, y: number): Point {
  const dy = end.y - start.y;
  if (Math.abs(dy) < 1e-6) {
    return { x: start.x, y };
  }
  const t = (y - start.y) / dy;
  return {
    x: start.x + (end.x - start.x) * t,
    y
  };
}

function clipPolygon(
  points: Point[],
  inside: (point: Point) => boolean,
  intersect: (start: Point, end: Point) => Point
): Point[] {
  if (points.length === 0) {
    return [];
  }

  const result: Point[] = [];
  let previous = points[points.length - 1];

  for (const current of points) {
    const currentInside = inside(current);
    const previousInside = inside(previous);

    if (currentInside) {
      if (!previousInside) {
        result.push(intersect(previous, current));
      }
      result.push(current);
    } else if (previousInside) {
      result.push(intersect(previous, current));
    }

    previous = current;
  }

  return result;
}

export function bakeAssignmentViewportToCropRect(
  assignment: LayoutAssignment,
  imageAspect: number,
  slotAspect: number
) {
  const geometry = getAssignmentViewportGeometry(assignment, imageAspect, slotAspect);
  const frameWidth = Math.max(geometry.frameWidthPercent, 0.001);
  const frameHeight = Math.max(geometry.frameHeightPercent, 0.001);
  const frameCenterX = 50 + geometry.offsetXPercent;
  const frameCenterY = 50 + geometry.offsetYPercent;
  const inverseRotation = (-geometry.rotationDeg * Math.PI) / 180;

  const viewportPolygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ].map((point) => {
    const relative = {
      x: point.x - frameCenterX,
      y: point.y - frameCenterY
    };
    return rotatePoint(relative, inverseRotation);
  });

  const halfWidth = frameWidth / 2;
  const halfHeight = frameHeight / 2;

  let clipped = clipPolygon(
    viewportPolygon,
    (point) => point.x >= -halfWidth,
    (start, end) => intersectVertical(start, end, -halfWidth)
  );
  clipped = clipPolygon(
    clipped,
    (point) => point.x <= halfWidth,
    (start, end) => intersectVertical(start, end, halfWidth)
  );
  clipped = clipPolygon(
    clipped,
    (point) => point.y >= -halfHeight,
    (start, end) => intersectHorizontal(start, end, -halfHeight)
  );
  clipped = clipPolygon(
    clipped,
    (point) => point.y <= halfHeight,
    (start, end) => intersectHorizontal(start, end, halfHeight)
  );

  if (clipped.length === 0) {
    return {
      left: geometry.cropLeft,
      top: geometry.cropTop,
      width: geometry.cropWidth,
      height: geometry.cropHeight
    };
  }

  const minX = Math.max(-halfWidth, Math.min(...clipped.map((point) => point.x)));
  const maxX = Math.min(halfWidth, Math.max(...clipped.map((point) => point.x)));
  const minY = Math.max(-halfHeight, Math.min(...clipped.map((point) => point.y)));
  const maxY = Math.min(halfHeight, Math.max(...clipped.map((point) => point.y)));

  const leftFraction = clamp((minX + halfWidth) / frameWidth, 0, 1);
  const topFraction = clamp((minY + halfHeight) / frameHeight, 0, 1);
  const widthFraction = clamp((maxX - minX) / frameWidth, 0.05, 1);
  const heightFraction = clamp((maxY - minY) / frameHeight, 0.05, 1);

  const width = clamp(geometry.cropWidth * widthFraction, 0.05, 1);
  const height = clamp(geometry.cropHeight * heightFraction, 0.05, 1);
  const left = clamp(geometry.cropLeft + geometry.cropWidth * leftFraction, 0, 1 - width);
  const top = clamp(geometry.cropTop + geometry.cropHeight * topFraction, 0, 1 - height);

  return { left, top, width, height };
}
