/**
 * DolphinGIS 3D 體素四邊形光線投射與精確座標計算模組
 * 無外部相依（不引入 Three.js 或 DOM），可供 3D 引擎與測試環境共用。
 */

export const FACE_NORMALS = [
  [0, 1, 0],  // 0: +Y 頂面
  [0, -1, 0], // 1: -Y 底面
  [1, 0, 0],  // 2: +X 東側面
  [-1, 0, 0], // 3: -X 西側面
  [0, 0, 1],  // 4: +Z 南側面
  [0, 0, -1], // 5: -Z 北側面
];

const DIR_EPS = 1e-8;
const SLAB_EPS = 1e-12;
const BOUND_CLAMP_EPS = 1e-4;

/**
 * 射線與軸對齊邊界盒 (AABB) 相交測試（Slab Method，防 0 * Infinity NaN）
 * @returns {number} 命中入場距離 (>= nearT)，未命中回傳 -1
 */
export function rayIntersectBoxEntry(rox, roy, roz, rdx, rdy, rdz, box, nearT = 0.5) {
  let tmin = -Infinity;
  let tmax = Infinity;

  // X 軸 Slab
  if (Math.abs(rdx) <= SLAB_EPS) {
    if (rox < box.min.x || rox > box.max.x) return -1;
  } else {
    const inv = 1 / rdx;
    let t1 = (box.min.x - rox) * inv;
    let t2 = (box.max.x - rox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Y 軸 Slab
  if (Math.abs(rdy) <= SLAB_EPS) {
    if (roy < box.min.y || roy > box.max.y) return -1;
  } else {
    const inv = 1 / rdy;
    let t1 = (box.min.y - roy) * inv;
    let t2 = (box.max.y - roy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Z 軸 Slab
  if (Math.abs(rdz) <= SLAB_EPS) {
    if (roz < box.min.z || roz > box.max.z) return -1;
  } else {
    const inv = 1 / rdz;
    let t1 = (box.min.z - roz) * inv;
    let t2 = (box.max.z - roz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  if (tmax < nearT || tmin > tmax) return -1;
  return tmin > nearT ? tmin : nearT;
}

/**
 * 檢查地獄 Y 軸或三軸 CT 電腦斷層裁切是否捨棄該命中點（與 FRAGMENT_SHADER 邏輯一致）
 */
function isClippedByView(
  worldX,
  worldY,
  worldZ,
  cutMode,
  clipY,
  ctClipAxis,
  ctClipVal,
  ctClipDir = 1,
  ctClipScope = 0,
  ctBoxMin = null,
  ctBoxMax = null
) {
  if (cutMode > 0.5 && cutMode < 1.5) {
    if (worldY >= 112.0 && worldY <= 128.02) return true;
  } else if (cutMode >= 1.5) {
    if (worldY > clipY) return true;
  }

  if (ctClipAxis > 0.5) {
    if (ctClipScope > 0.5 && ctBoxMin && ctBoxMax) {
      const inX = worldX >= ctBoxMin[0] && worldX <= ctBoxMax[0];
      const inY = worldY >= ctBoxMin[1] && worldY <= ctBoxMax[1];
      const inZ = worldZ >= ctBoxMin[2] && worldZ <= ctBoxMax[2];
      const inScope =
        ctClipAxis < 1.5
          ? inX && inZ && (ctClipDir > 0 ? worldY >= ctBoxMin[1] : worldY <= ctBoxMax[1])
          : inX && inY && inZ;
      if (!inScope) return false;
    }

    const coordVal = ctClipAxis < 1.5 ? worldY : ctClipAxis < 2.5 ? worldX : worldZ;
    if (ctClipDir > 0 ? coordVal > ctClipVal : coordVal < ctClipVal) return true;
  }
  return false;
}

/**
 * 對單一 VXQ packed quad Uint32Array 執行射線相交測試
 * @param {Uint32Array} arr aQuad 緩衝區（每 quad 佔 3 個 uint32）
 * @param {number} quadCount 有效 instance 數量
 * @param {number[]} tileOffset 地磚相對於局部原點之偏移 [offX, offY, offZ]
 * @param {number[]} rayOrigin 局部空間射線起點 [x, y, z]
 * @param {number[]} rayDir 局部空間射線方向單位向量 [dx, dy, dz]
 * @param {object} [options]
 */
export function raycastQuadBuffer(arr, quadCount, tileOffset, rayOrigin, rayDir, options = {}) {
  if (!arr || quadCount <= 0 || arr.length < quadCount * 3) return null;

  const {
    doubleSide = false,
    nearT = 0.5,
    maxT = Infinity,
    worldOrigin = [0, 0, 0],
    worldOriginY = worldOrigin[1] || 0,
    cutMode = 0,
    clipY = 112,
    ctClipAxis = 0,
    ctClipVal = 0,
    ctClipDir = 1,
    ctClipScope = 0,
    ctBoxMin = null,
    ctBoxMax = null,
  } = options;

  const [rdx, rdy, rdz] = rayDir;
  const invX = Math.abs(rdx) > DIR_EPS ? 1 / rdx : 0;
  const invY = Math.abs(rdy) > DIR_EPS ? 1 / rdy : 0;
  const invZ = Math.abs(rdz) > DIR_EPS ? 1 / rdz : 0;

  let faceMask = 0;
  if (doubleSide) {
    if (invY !== 0) faceMask |= (1 << 0) | (1 << 1);
    if (invX !== 0) faceMask |= (1 << 2) | (1 << 3);
    if (invZ !== 0) faceMask |= (1 << 4) | (1 << 5);
  } else {
    if (rdx < -DIR_EPS) faceMask |= 1 << 2;
    else if (rdx > DIR_EPS) faceMask |= 1 << 3;
    if (rdy < -DIR_EPS) faceMask |= 1 << 0;
    else if (rdy > DIR_EPS) faceMask |= 1 << 1;
    if (rdz < -DIR_EPS) faceMask |= 1 << 4;
    else if (rdz > DIR_EPS) faceMask |= 1 << 5;
  }

  if (faceMask === 0) return null;

  const offX = tileOffset[0];
  const offY = tileOffset[1];
  const offZ = tileOffset[2];
  const ox = rayOrigin[0] - offX;
  const oy = rayOrigin[1] - offY;
  const oz = rayOrigin[2] - offZ;
  const hasCut = cutMode > 0.5 || ctClipAxis > 0.5;
  const woX = worldOrigin[0] || 0;
  const woY = worldOriginY;
  const woZ = worldOrigin[2] || 0;

  let bestT = maxT;
  let bestFace = -1;
  let bestQuadIndex = -1;
  let bestX = 0;
  let bestY = 0;
  let bestZ = 0;

  for (let i = 0, len = quadCount * 3; i < len; i += 3) {
    const w0 = arr[i];
    const f = (w0 >>> 25) & 7;
    if ((faceMask & (1 << f)) === 0) continue;

    if (f <= 1) {
      const qy = (w0 >>> 8) & 0x1ff;
      const t = (qy - oy) * invY;
      if (t < nearT || t >= bestT) continue;

      const qx = w0 & 0xff;
      const u = ox + rdx * t;
      if (u < qx) continue;

      const w1 = arr[i + 1];
      const h = (w1 & 0x1ff) + 1;
      if (u > qx + h) continue;

      const qz = (w0 >>> 17) & 0xff;
      const v = oz + rdz * t;
      const w = ((w1 >>> 9) & 0x1ff) + 1;
      if (v < qz || v > qz + w) continue;

      const lx = Math.min(u, qx + h - BOUND_CLAMP_EPS) + offX;
      const ly = qy + offY;
      const lz = Math.min(v, qz + w - BOUND_CLAMP_EPS) + offZ;
      if (
        hasCut &&
        isClippedByView(
          lx + woX,
          ly + woY,
          lz + woZ,
          cutMode,
          clipY,
          ctClipAxis,
          ctClipVal,
          ctClipDir,
          ctClipScope,
          ctBoxMin,
          ctBoxMax
        )
      ) {
        continue;
      }

      bestT = t;
      bestFace = f;
      bestQuadIndex = i / 3;
      bestX = lx;
      bestY = ly;
      bestZ = lz;
    } else if (f <= 3) {
      const qx = w0 & 0xff;
      const t = (qx - ox) * invX;
      if (t < nearT || t >= bestT) continue;

      const qy = (w0 >>> 8) & 0x1ff;
      const u = oy + rdy * t;
      if (u < qy) continue;

      const w1 = arr[i + 1];
      const h = (w1 & 0x1ff) + 1;
      if (u > qy + h) continue;

      const qz = (w0 >>> 17) & 0xff;
      const v = oz + rdz * t;
      const w = ((w1 >>> 9) & 0x1ff) + 1;
      if (v < qz || v > qz + w) continue;

      const lx = qx + offX;
      const ly = Math.min(u, qy + h - BOUND_CLAMP_EPS) + offY;
      const lz = Math.min(v, qz + w - BOUND_CLAMP_EPS) + offZ;
      if (
        hasCut &&
        isClippedByView(
          lx + woX,
          ly + woY,
          lz + woZ,
          cutMode,
          clipY,
          ctClipAxis,
          ctClipVal,
          ctClipDir,
          ctClipScope,
          ctBoxMin,
          ctBoxMax
        )
      ) {
        continue;
      }

      bestT = t;
      bestFace = f;
      bestQuadIndex = i / 3;
      bestX = lx;
      bestY = ly;
      bestZ = lz;
    } else {
      const qz = (w0 >>> 17) & 0xff;
      const t = (qz - oz) * invZ;
      if (t < nearT || t >= bestT) continue;

      const qx = w0 & 0xff;
      const u = ox + rdx * t;
      if (u < qx) continue;

      const w1 = arr[i + 1];
      const h = (w1 & 0x1ff) + 1;
      if (u > qx + h) continue;

      const qy = (w0 >>> 8) & 0x1ff;
      const v = oy + rdy * t;
      const w = ((w1 >>> 9) & 0x1ff) + 1;
      if (v < qy || v > qy + w) continue;

      const lx = Math.min(u, qx + h - BOUND_CLAMP_EPS) + offX;
      const ly = Math.min(v, qy + w - BOUND_CLAMP_EPS) + offY;
      const lz = qz + offZ;
      if (
        hasCut &&
        isClippedByView(
          lx + woX,
          ly + woY,
          lz + woZ,
          cutMode,
          clipY,
          ctClipAxis,
          ctClipVal,
          ctClipDir,
          ctClipScope,
          ctBoxMin,
          ctBoxMax
        )
      ) {
        continue;
      }

      bestT = t;
      bestFace = f;
      bestQuadIndex = i / 3;
      bestX = lx;
      bestY = ly;
      bestZ = lz;
    }
  }

  if (bestFace < 0) return null;
  const w2 = arr[bestQuadIndex * 3 + 2];
  return {
    t: bestT,
    faceId: bestFace,
    quadIndex: bestQuadIndex,
    colorRgba: [w2 & 0xff, (w2 >>> 8) & 0xff, (w2 >>> 16) & 0xff, (w2 >>> 24) & 0xff],
    localX: bestX,
    localY: bestY,
    localZ: bestZ,
  };
}

/**
 * 將命中點換算為 Minecraft 被點擊方塊座標與 Y+1 傳送落點座標
 */
export function computeHitCoordinates(hit, rayDir, worldOrigin) {
  const fn = FACE_NORMALS[hit.faceId] || FACE_NORMALS[0];
  const dot = rayDir[0] * fn[0] + rayDir[1] * fn[1] + rayDir[2] * fn[2];
  // 若射線從背面擊中雙面網格，反轉朝向射線起點的法線（避免產生 -0）
  const outNormal = dot > 0
    ? [-fn[0] || 0, -fn[1] || 0, -fn[2] || 0]
    : [fn[0], fn[1], fn[2]];

  const wx = hit.localX + worldOrigin[0];
  const wy = hit.localY + worldOrigin[1];
  const wz = hit.localZ + worldOrigin[2];

  // 沿外法線向內微偏 0.01 並以 Math.floor 取得整數方塊索引，確保負座標與貼邊無誤
  const blockX = Math.floor(wx - outNormal[0] * 0.01);
  const blockY = Math.floor(wy - outNormal[1] * 0.01);
  const blockZ = Math.floor(wz - outNormal[2] * 0.01);

  return {
    blockX,
    blockY,
    blockZ,
    // 點擊頂/底面維持同 X/Z；點擊垂直牆面時水平外推 1 格至空氣格，並一律落於被點方塊之 Y+1
    x: blockX + outNormal[0],
    y: blockY + 1,
    z: blockZ + outNormal[2],
    faceId: hit.faceId,
    outNormal,
    t: hit.t,
    hitLocal: [hit.localX, hit.localY, hit.localZ],
  };
}

/**
 * 測試單一網格緩衝區並回傳較近之命中結果
 */
function testMeshHit(mesh, tileOffset, rayOrigin, rayDir, opts) {
  const quadAttr = mesh?.geometry?.getAttribute?.("aQuad");
  const quadCount = mesh?.geometry?.instanceCount || 0;
  if (!quadAttr?.array || quadCount <= 0) return null;
  return raycastQuadBuffer(quadAttr.array, quadCount, tileOffset, rayOrigin, rayDir, opts);
}

/**
 * 對所有已載入且可見的 3D 地磚執行由近到遠的光線投射選點
 */
export function pickVoxelTerrain(tiles, rayOrigin, rayDir, options = {}) {
  if (!Array.isArray(tiles) || tiles.length === 0) return null;

  const {
    nearT = 0.5,
    maxT = Infinity,
    showTranslucent = true,
    worldOrigin = [0, 0, 0],
    cutMode = 0,
    clipY = 112,
    ctClipAxis = 0,
    ctClipVal = 0,
    ctClipDir = 1,
    ctClipScope = 0,
    ctBoxMin = null,
    ctBoxMax = null,
  } = options;

  const [rox, roy, roz] = rayOrigin;
  const [rdx, rdy, rdz] = rayDir;
  const candidates = [];

  for (const tile of tiles) {
    if (tile.state !== "loaded" || !tile.group || !tile.group.visible || !tile.boundingBox) {
      continue;
    }
    const tEntry = rayIntersectBoxEntry(rox, roy, roz, rdx, rdy, rdz, tile.boundingBox, nearT);
    if (tEntry >= 0 && tEntry < maxT) {
      candidates.push({ tile, tEntry });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.tEntry - b.tEntry);

  let bestT = maxT;
  let bestHit = null;
  let bestTile = null;
  let bestIsTranslucent = false;

  for (const { tile, tEntry } of candidates) {
    if (tEntry >= bestT) break;
    const tileOffset = tile.tileOffset;
    if (!tileOffset) continue;

    if (tile.solidMesh && tile.solidMesh.visible !== false) {
      const solidHit = testMeshHit(tile.solidMesh, tileOffset, rayOrigin, rayDir, {
        doubleSide: false,
        nearT,
        maxT: bestT,
        worldOrigin,
        worldOriginY: worldOrigin[1],
        cutMode,
        clipY,
        ctClipAxis,
        ctClipVal,
        ctClipDir,
        ctClipScope,
        ctBoxMin,
        ctBoxMax,
      });
      if (solidHit && solidHit.t < bestT) {
        bestT = solidHit.t;
        bestHit = solidHit;
        bestTile = tile;
        bestIsTranslucent = false;
      }
    }

    if (showTranslucent && tile.transMesh && tile.transMesh.visible) {
      const transHit = testMeshHit(tile.transMesh, tileOffset, rayOrigin, rayDir, {
        doubleSide: true,
        nearT,
        maxT: bestT,
        worldOrigin,
        worldOriginY: worldOrigin[1],
        cutMode,
        clipY,
        ctClipAxis,
        ctClipVal,
        ctClipDir,
        ctClipScope,
        ctBoxMin,
        ctBoxMax,
      });
      if (transHit && transHit.t < bestT) {
        bestT = transHit.t;
        bestHit = transHit;
        bestTile = tile;
        bestIsTranslucent = true;
      }
    }
  }

  if (!bestHit) return null;

  let blockName = null;
  if (bestTile) {
    const bids = bestIsTranslucent ? bestTile.transBids : bestTile.solidBids;
    const palette = bestTile.palette;
    if (bids && palette && bestHit.quadIndex >= 0 && bestHit.quadIndex < bids.length) {
      const bid = bids[bestHit.quadIndex];
      if (bid < palette.length) {
        blockName = palette[bid];
      }
    }
  }

  return {
    ...computeHitCoordinates(bestHit, rayDir, worldOrigin),
    isTranslucent: bestIsTranslucent,
    blockName,
    colorRgba: bestHit.colorRgba || null,
  };
}

/**
 * 依兩個 3D 角點計算真實 3D 立方體邊界（以第一點為錨點對 X/Z 執行最大跨度夾限）
 */
export function computeTwoPointBox(p1, p2, options = {}) {
  const maxSpanXZ = Number.isFinite(options.maxSpanXZ) ? options.maxSpanXZ : 250;
  const yMinLimit = Number.isFinite(options.yMinLimit) ? options.yMinLimit : -64;
  const yMaxLimit = Number.isFinite(options.yMaxLimit) ? options.yMaxLimit : 319;

  const x1 = Math.floor(p1.x);
  const z1 = Math.floor(p1.z);
  let x2 = Math.floor(p2.x);
  let z2 = Math.floor(p2.z);
  let clamped = false;

  if (Math.abs(x2 - x1) + 1 > maxSpanXZ) {
    x2 = x1 + Math.sign(x2 - x1) * (maxSpanXZ - 1);
    clamped = true;
  }
  if (Math.abs(z2 - z1) + 1 > maxSpanXZ) {
    z2 = z1 + Math.sign(z2 - z1) * (maxSpanXZ - 1);
    clamped = true;
  }

  const clampY = (y) => Math.max(yMinLimit, Math.min(yMaxLimit, Math.floor(y)));
  const y1 = clampY(p1.y);
  const y2 = clampY(p2.y);

  return {
    xMin: Math.min(x1, x2),
    xMax: Math.max(x1, x2),
    yMin: Math.min(y1, y2),
    yMax: Math.max(y1, y2),
    zMin: Math.min(z1, z2),
    zMax: Math.max(z1, z2),
    clamped,
  };
}

/**
 * 計算 object-fit: contain 元素內實際內容影像繪製矩形（相對於元素內容區左上角）
 */
export function computeContainedRect(boxWidth, boxHeight, imgWidth, imgHeight) {
  if (boxWidth <= 0 || boxHeight <= 0 || imgWidth <= 0 || imgHeight <= 0) {
    return null;
  }
  const boxRatio = boxWidth / boxHeight;
  const imgRatio = imgWidth / imgHeight;

  let drawWidth = boxWidth;
  let drawHeight = boxHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (imgRatio > boxRatio) {
    drawHeight = boxWidth / imgRatio;
    offsetY = (boxHeight - drawHeight) * 0.5;
  } else {
    drawWidth = boxHeight * imgRatio;
    offsetX = (boxWidth - drawWidth) * 0.5;
  }

  return { offsetX, offsetY, width: drawWidth, height: drawHeight };
}

/**
 * 將 2D CT 預覽畫布上的點擊/懸停偏移轉換為格子索引 (col, visRow, dataRow)，位於留白黑邊外則回傳 null
 */
export function mapCtCanvasPointToGrid(relX, relY, boxWidth, boxHeight, width, height, axis) {
  const content = computeContainedRect(boxWidth, boxHeight, width, height);
  if (!content || content.width <= 0 || content.height <= 0) return null;

  const localX = relX - content.offsetX;
  const localY = relY - content.offsetY;
  if (localX < 0 || localX >= content.width || localY < 0 || localY >= content.height) {
    return null;
  }

  const col = Math.min(width - 1, Math.max(0, Math.floor((localX / content.width) * width)));
  const visRow = Math.min(height - 1, Math.max(0, Math.floor((localY / content.height) * height)));
  const dataRow = axis === 0 ? visRow : height - 1 - visRow;
  return { col, visRow, dataRow };
}
