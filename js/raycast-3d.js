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
 * 檢查地獄 Y 軸剖面裁切是否捨棄該命中點（與 FRAGMENT_SHADER 邏輯一致）
 */
function isClippedByNetherCut(worldY, cutMode, clipY) {
  if (cutMode > 0.5 && cutMode < 1.5) {
    return worldY >= 112.0 && worldY <= 128.02;
  }
  if (cutMode >= 1.5) {
    return worldY > clipY;
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
    worldOriginY = 0,
    cutMode = 0,
    clipY = 112,
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
  const hasCut = cutMode > 0.5;

  let bestT = maxT;
  let bestFace = -1;
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

      if (hasCut && isClippedByNetherCut(qy + offY + worldOriginY, cutMode, clipY)) continue;

      bestT = t;
      bestFace = f;
      bestX = Math.min(u, qx + h - BOUND_CLAMP_EPS) + offX;
      bestY = qy + offY;
      bestZ = Math.min(v, qz + w - BOUND_CLAMP_EPS) + offZ;
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

      const clampedY = Math.min(u, qy + h - BOUND_CLAMP_EPS);
      if (hasCut && isClippedByNetherCut(clampedY + offY + worldOriginY, cutMode, clipY)) continue;

      bestT = t;
      bestFace = f;
      bestX = qx + offX;
      bestY = clampedY + offY;
      bestZ = Math.min(v, qz + w - BOUND_CLAMP_EPS) + offZ;
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

      const clampedY = Math.min(v, qy + w - BOUND_CLAMP_EPS);
      if (hasCut && isClippedByNetherCut(clampedY + offY + worldOriginY, cutMode, clipY)) continue;

      bestT = t;
      bestFace = f;
      bestX = Math.min(u, qx + h - BOUND_CLAMP_EPS) + offX;
      bestY = clampedY + offY;
      bestZ = qz + offZ;
    }
  }

  if (bestFace < 0) return null;
  return {
    t: bestT,
    faceId: bestFace,
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
        worldOriginY: worldOrigin[1],
        cutMode,
        clipY,
      });
      if (solidHit && solidHit.t < bestT) {
        bestT = solidHit.t;
        bestHit = solidHit;
        bestIsTranslucent = false;
      }
    }

    if (showTranslucent && tile.transMesh && tile.transMesh.visible) {
      const transHit = testMeshHit(tile.transMesh, tileOffset, rayOrigin, rayDir, {
        doubleSide: true,
        nearT,
        maxT: bestT,
        worldOriginY: worldOrigin[1],
        cutMode,
        clipY,
      });
      if (transHit && transHit.t < bestT) {
        bestT = transHit.t;
        bestHit = transHit;
        bestIsTranslucent = true;
      }
    }
  }

  if (!bestHit) return null;

  return {
    ...computeHitCoordinates(bestHit, rayDir, worldOrigin),
    isTranslucent: bestIsTranslucent,
  };
}
