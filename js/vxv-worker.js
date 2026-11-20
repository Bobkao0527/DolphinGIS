// 背景 Web Worker：負責按需串流下載全高體素磚 (.vxv.gz)、LRU 快取管理、跨磚區域組裝、統計、特定方塊網格化與三軸 CT 切面

let wasmReady = null;
const textDecoder = new TextDecoder();
const MAX_VXV_TILE_CACHE = 12;
const MAX_BOX_SPAN_XZ = 250;
const MAX_BOX_SPAN_Y = 511;
const MAX_BOX_TILES = 9;
const MAX_BOX_VOXELS = 16777216; // 16M voxels 上限防記憶體爆掉

const tileCache = new Map();
let activeBox = null;

async function ensureWasm() {
  if (wasmReady) return wasmReady;
  wasmReady = (async () => {
    const res = await fetch("../wasm/vxq_wasm.wasm");
    if (!res.ok) throw new Error(`載入 vxq_wasm.wasm 失敗 (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buf, {});
    return instance.exports;
  })().catch((err) => {
    wasmReady = null;
    throw err;
  });
  return wasmReady;
}

function isGzipMagic(u8) {
  return u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}

function isVxvMagic(u8) {
  return (
    u8.length >= 4 &&
    u8[0] === 0x56 &&
    u8[1] === 0x58 &&
    u8[2] === 0x56 &&
    u8[3] === 0x31 // "VXV1"
  );
}

function touchCache(key, entry) {
  tileCache.delete(key);
  tileCache.set(key, entry);
  while (tileCache.size > MAX_VXV_TILE_CACHE) {
    const oldestKey = tileCache.keys().next().value;
    tileCache.delete(oldestKey);
  }
}

async function fetchAndDecodeVxvTile(baseUrl, dimId, meta) {
  const cacheKey = `${dimId}/${meta.file}`;
  if (tileCache.has(cacheKey)) {
    const cached = tileCache.get(cacheKey);
    touchCache(cacheKey, cached);
    return cached;
  }

  const url = `${baseUrl}/${dimId}/voxels/${meta.file}`;
  const [wasm, res] = await Promise.all([
    ensureWasm(),
    fetch(url, { mode: "cors" }),
  ]);
  if (!res.ok) {
    throw new Error(`下載體素磚失敗 ${meta.file} (HTTP ${res.status})`);
  }

  const fetchedBuf = await res.arrayBuffer();
  const fetchedBytes = new Uint8Array(fetchedBuf);

  let rawBuf;
  if (isVxvMagic(fetchedBytes)) {
    rawBuf = fetchedBuf;
  } else if (meta.gzip || isGzipMagic(fetchedBytes)) {
    const ds = new DecompressionStream("gzip");
    const decompressed = new Response(fetchedBuf).body.pipeThrough(ds);
    rawBuf = await new Response(decompressed).arrayBuffer();
  } else {
    rawBuf = fetchedBuf;
  }

  const bytes = new Uint8Array(rawBuf);
  let dataPtr = 0;
  let infoPtr = 0;
  let gridPtr = 0;
  let gridByteLen = 0;

  try {
    dataPtr = wasm.wasm_alloc(bytes.length);
    infoPtr = wasm.wasm_alloc(48); // 12 * u32
    if (!dataPtr || !infoPtr) {
      throw new Error("WASM VXV1 表頭記憶體配置失敗");
    }
    new Uint8Array(wasm.memory.buffer, dataPtr, bytes.length).set(bytes);

    const hrc = wasm.vxv_header_info(dataPtr, bytes.length, infoPtr);
    if (hrc !== 0) {
      throw new Error(`VXV1 表頭驗證失敗 (code=${hrc})`);
    }

    const memBuf = wasm.memory.buffer;
    const infoU32 = new Uint32Array(memBuf, infoPtr, 12);
    const infoI32 = new Int32Array(memBuf, infoPtr, 3);

    const xMin = infoI32[0];
    const yMin = infoI32[1];
    const zMin = infoI32[2];
    const sx = infoU32[3];
    const sy = infoU32[4];
    const sz = infoU32[5];
    const paletteCnt = infoU32[6];
    const grassBid = infoU32[7];
    const stylesOff = infoU32[8];
    const namesOff = infoU32[9];
    const namesLen = infoU32[10];

    const paletteNames = namesLen > 0
      ? textDecoder.decode(bytes.subarray(namesOff, namesOff + namesLen)).split("\n")
      : ["minecraft:air"];
    const stylesRgba = new Uint8Array(paletteCnt * 4);
    const stylesFlags = new Uint8Array(paletteCnt);
    for (let i = 0; i < paletteCnt; i++) {
      const o = stylesOff + i * 5;
      stylesRgba[i * 4] = bytes[o];
      stylesRgba[i * 4 + 1] = bytes[o + 1];
      stylesRgba[i * 4 + 2] = bytes[o + 2];
      stylesRgba[i * 4 + 3] = bytes[o + 3];
      stylesFlags[i] = bytes[o + 4];
    }

    const totalVoxels = sx * sy * sz;
    gridByteLen = totalVoxels * 2;
    gridPtr = wasm.wasm_alloc(gridByteLen);
    if (!gridPtr) {
      throw new Error("WASM VXV1 體素陣列配置失敗");
    }

    const urc = wasm.vxv_unpack_grid(dataPtr, bytes.length, gridPtr);
    if (urc !== 0) {
      throw new Error(`VXV1 分區解包失敗 (code=${urc})`);
    }

    const grid = new Uint16Array(wasm.memory.buffer, gridPtr, totalVoxels).slice();
    const entry = {
      key: cacheKey,
      xMin,
      yMin,
      zMin,
      sx,
      sy,
      sz,
      paletteNames,
      stylesRgba,
      stylesFlags,
      grassBid,
      grid,
    };
    touchCache(cacheKey, entry);
    return entry;
  } finally {
    if (gridPtr) wasm.wasm_free(gridPtr, gridByteLen);
    if (infoPtr) wasm.wasm_free(infoPtr, 48);
    if (dataPtr) wasm.wasm_free(dataPtr, bytes.length);
  }
}

async function handlePrepareBox({ baseUrl, dimId, box, tileMetas }) {
  const x0 = Math.floor(Math.min(box.xMin, box.xMax));
  const x1 = Math.floor(Math.max(box.xMin, box.xMax));
  const y0 = Math.floor(Math.min(box.yMin, box.yMax));
  const y1 = Math.floor(Math.max(box.yMin, box.yMax));
  const z0 = Math.floor(Math.min(box.zMin, box.zMax));
  const z1 = Math.floor(Math.max(box.zMin, box.zMax));

  const sx = x1 - x0 + 1;
  const sy = y1 - y0 + 1;
  const sz = z1 - z0 + 1;

  if (sx <= 0 || sy <= 0 || sz <= 0) {
    throw new Error("框選範圍無效");
  }
  if (sx > MAX_BOX_SPAN_XZ || sz > MAX_BOX_SPAN_XZ) {
    throw new Error(`單次 X/Z 分析寬度上限為 ${MAX_BOX_SPAN_XZ} 格（目前 ${sx}×${sz}）`);
  }
  if (sy > MAX_BOX_SPAN_Y) {
    throw new Error(`單次 Y 軸高度上限為 ${MAX_BOX_SPAN_Y} 格（目前 ${sy}）`);
  }
  const totalVoxels = sx * sy * sz;
  if (totalVoxels > MAX_BOX_VOXELS) {
    throw new Error(`框選體素總數不可超過 ${(MAX_BOX_VOXELS / 1e6).toFixed(1)}M 格`);
  }

  const matched = (tileMetas || []).filter(
    (t) =>
      t.xMax >= x0 &&
      t.xMin <= x1 &&
      t.zMax >= z0 &&
      t.zMin <= z1 &&
      (t.yMax ?? 319) >= y0 &&
      (t.yMin ?? -64) <= y1
  );
  if (matched.length > MAX_BOX_TILES) {
    throw new Error(`框選橫跨過多體素磚（${matched.length} > ${MAX_BOX_TILES}），請縮小範圍`);
  }

  const decodedTiles = await Promise.all(
    matched.map((meta) => fetchAndDecodeVxvTile(baseUrl, dimId, meta))
  );

  // 合併多塊地磚的調色盤（index 0 固定為 minecraft:air）
  const nameToId = new Map([["minecraft:air", 0]]);
  const mergedNames = ["minecraft:air"];
  const rgbaList = [0, 0, 0, 0];
  const flagsList = [0];

  const remaps = decodedTiles.map((tile) => {
    const remap = new Uint16Array(tile.paletteNames.length);
    for (let i = 0; i < tile.paletteNames.length; i++) {
      const bname = tile.paletteNames[i] || "minecraft:air";
      if (nameToId.has(bname)) {
        remap[i] = nameToId.get(bname);
      } else {
        const nid = mergedNames.length;
        if (nid >= 65535) {
          remap[i] = 0;
          continue;
        }
        nameToId.set(bname, nid);
        mergedNames.push(bname);
        const s4 = i * 4;
        rgbaList.push(
          tile.stylesRgba[s4],
          tile.stylesRgba[s4 + 1],
          tile.stylesRgba[s4 + 2],
          tile.stylesRgba[s4 + 3]
        );
        flagsList.push(tile.stylesFlags[i]);
        remap[i] = nid;
      }
    }
    return remap;
  });

  const boxGrid = new Uint16Array(totalVoxels);
  for (let ti = 0; ti < decodedTiles.length; ti++) {
    const tile = decodedTiles[ti];
    const remap = remaps[ti];
    const ox0 = Math.max(x0, tile.xMin);
    const ox1 = Math.min(x1, tile.xMin + tile.sx - 1);
    const oy0 = Math.max(y0, tile.yMin);
    const oy1 = Math.min(y1, tile.yMin + tile.sy - 1);
    const oz0 = Math.max(z0, tile.zMin);
    const oz1 = Math.min(z1, tile.zMin + tile.sz - 1);
    if (ox0 > ox1 || oy0 > oy1 || oz0 > oz1) continue;

    const tGrid = tile.grid;
    const tSx = tile.sx;
    const tSz = tile.sz;
    const spanX = ox1 - ox0 + 1;

    for (let wy = oy0; wy <= oy1; wy++) {
      const dstYOff = (wy - y0) * sz * sx;
      const srcYOff = (wy - tile.yMin) * tSz * tSx;
      for (let wz = oz0; wz <= oz1; wz++) {
        const dstRow = dstYOff + (wz - z0) * sx + (ox0 - x0);
        const srcRow = srcYOff + (wz - tile.zMin) * tSx + (ox0 - tile.xMin);
        for (let dx = 0; dx < spanX; dx++) {
          boxGrid[dstRow + dx] = remap[tGrid[srcRow + dx]];
        }
      }
    }
  }

  const numStyles = mergedNames.length;
  const stylesRgba = Uint8Array.from(rgbaList);
  const stylesFlags = Uint8Array.from(flagsList);
  const grassBid = nameToId.has("minecraft:grass_block") ? nameToId.get("minecraft:grass_block") : -1;

  // 呼叫 WASM 統計框內各方塊數量（含空氣）
  const wasm = await ensureWasm();
  let gridPtr = 0;
  let countsPtr = 0;
  const countsByteLen = numStyles * 4;
  let countsArr;

  try {
    gridPtr = wasm.wasm_alloc(boxGrid.byteLength);
    countsPtr = wasm.wasm_alloc(countsByteLen);
    if (!gridPtr || !countsPtr) {
      throw new Error("WASM 統計記憶體配置失敗");
    }
    new Uint16Array(wasm.memory.buffer, gridPtr, boxGrid.length).set(boxGrid);
    const rc = wasm.vxv_count_box(gridPtr, boxGrid.length, numStyles, countsPtr);
    if (rc !== 0) {
      throw new Error(`WASM 方塊統計失敗 (code=${rc})`);
    }
    countsArr = new Uint32Array(wasm.memory.buffer, countsPtr, numStyles).slice();
  } finally {
    if (countsPtr) wasm.wasm_free(countsPtr, countsByteLen);
    if (gridPtr) wasm.wasm_free(gridPtr, boxGrid.byteLength);
  }

  const stats = [];
  for (let bid = 0; bid < numStyles; bid++) {
    const count = countsArr[bid];
    if (count === 0) continue;
    const isAir = bid === 0;
    const rgba = isAir
      ? [56, 215, 255, 220]
      : [
          stylesRgba[bid * 4],
          stylesRgba[bid * 4 + 1],
          stylesRgba[bid * 4 + 2],
          stylesRgba[bid * 4 + 3],
        ];
    stats.push({
      bid,
      name: mergedNames[bid],
      count,
      pct: (count / totalVoxels) * 100,
      rgba,
    });
  }
  stats.sort((a, b) => b.count - a.count);

  activeBox = {
    x0,
    x1,
    y0,
    y1,
    z0,
    z1,
    sx,
    sy,
    sz,
    grid: boxGrid,
    paletteNames: mergedNames,
    stylesRgba,
    stylesFlags,
    grassBid,
  };

  return {
    box: { xMin: x0, xMax: x1, yMin: y0, yMax: y1, zMin: z0, zMax: z1 },
    dims: [sx, sy, sz],
    totalVoxels,
    tilesUsed: decodedTiles.length,
    stats,
  };
}

async function handleBuildFilterMesh({ selectedBids }) {
  if (!activeBox) {
    throw new Error("尚未準備分析區域");
  }
  const bids = Array.isArray(selectedBids) ? selectedBids : [];
  if (bids.length === 0) {
    return {
      solidCount: 0,
      transCount: 0,
      aabb: [0, 0, 0, 0, 0, 0],
      boxOrigin: [activeBox.x0, activeBox.y0, activeBox.z0],
      solidBuf: new ArrayBuffer(0),
      transBuf: new ArrayBuffer(0),
      transferables: [],
    };
  }

  const wasm = await ensureWasm();
  const { sx, sy, sz, grid, paletteNames, stylesRgba, stylesFlags, grassBid } = activeBox;
  const numStyles = paletteNames.length;
  const mask = new Uint8Array(numStyles);
  for (const bid of bids) {
    if (bid >= 0 && bid < numStyles) mask[bid] = 1;
  }

  let gridPtr = 0;
  let rgbaPtr = 0;
  let flagsPtr = 0;
  let maskPtr = 0;
  let metaPtr = 0;
  let quadsPtr = 0;
  let totalQuads = 0;

  try {
    gridPtr = wasm.wasm_alloc(grid.byteLength);
    rgbaPtr = wasm.wasm_alloc(stylesRgba.byteLength);
    flagsPtr = wasm.wasm_alloc(stylesFlags.byteLength);
    maskPtr = wasm.wasm_alloc(mask.byteLength);
    metaPtr = wasm.wasm_alloc(32); // 8 * u32
    if (!gridPtr || !rgbaPtr || !flagsPtr || !maskPtr || !metaPtr) {
      throw new Error("WASM 網格篩選記憶體配置失敗");
    }

    const memBuf0 = wasm.memory.buffer;
    new Uint16Array(memBuf0, gridPtr, grid.length).set(grid);
    new Uint8Array(memBuf0, rgbaPtr, stylesRgba.length).set(stylesRgba);
    new Uint8Array(memBuf0, flagsPtr, stylesFlags.length).set(stylesFlags);
    new Uint8Array(memBuf0, maskPtr, mask.length).set(mask);

    quadsPtr = wasm.vxv_filter_mesh(
      gridPtr,
      sy,
      sz,
      sx,
      rgbaPtr,
      flagsPtr,
      maskPtr,
      numStyles,
      grassBid,
      metaPtr
    );

    const memBuf1 = wasm.memory.buffer;
    const meta = new Uint32Array(memBuf1, metaPtr, 8);
    const solidCount = meta[0];
    const transCount = meta[1];
    totalQuads = solidCount + transCount;
    const aabb = [meta[2], meta[3], meta[4], meta[5], meta[6], meta[7]];

    if (!quadsPtr || totalQuads === 0) {
      return {
        solidCount: 0,
        transCount: 0,
        aabb: [0, 0, 0, 0, 0, 0],
        boxOrigin: [activeBox.x0, activeBox.y0, activeBox.z0],
        solidBuf: new ArrayBuffer(0),
        transBuf: new ArrayBuffer(0),
        transferables: [],
      };
    }

    const solidArr = solidCount > 0
      ? new Uint32Array(memBuf1, quadsPtr, solidCount * 3).slice()
      : new Uint32Array(0);
    const transArr = transCount > 0
      ? new Uint32Array(memBuf1, quadsPtr + solidCount * 12, transCount * 3).slice()
      : new Uint32Array(0);

    return {
      solidCount,
      transCount,
      aabb,
      boxOrigin: [activeBox.x0, activeBox.y0, activeBox.z0],
      solidBuf: solidArr.buffer,
      transBuf: transArr.buffer,
      transferables: [solidArr.buffer, transArr.buffer],
    };
  } finally {
    if (quadsPtr && totalQuads > 0) wasm.vxv_free_u32(quadsPtr, totalQuads * 3);
    if (metaPtr) wasm.wasm_free(metaPtr, 32);
    if (maskPtr) wasm.wasm_free(maskPtr, mask.byteLength);
    if (flagsPtr) wasm.wasm_free(flagsPtr, stylesFlags.byteLength);
    if (rgbaPtr) wasm.wasm_free(rgbaPtr, stylesRgba.byteLength);
    if (gridPtr) wasm.wasm_free(gridPtr, grid.byteLength);
  }
}

async function handleExtractSlice({ axis, coord }) {
  if (!activeBox) {
    throw new Error("尚未準備分析區域");
  }
  const wasm = await ensureWasm();
  const { x0, y0, z0, sx, sy, sz, grid, paletteNames, stylesRgba } = activeBox;
  const numStyles = paletteNames.length;

  let sliceIdx = 0;
  let width = sx;
  let height = sz;
  let actualCoord = coord;

  if (axis === 0) {
    sliceIdx = Math.max(0, Math.min(sy - 1, Math.floor(coord) - y0));
    actualCoord = y0 + sliceIdx;
    width = sx;
    height = sz;
  } else if (axis === 1) {
    sliceIdx = Math.max(0, Math.min(sx - 1, Math.floor(coord) - x0));
    actualCoord = x0 + sliceIdx;
    width = sz;
    height = sy;
  } else {
    sliceIdx = Math.max(0, Math.min(sz - 1, Math.floor(coord) - z0));
    actualCoord = z0 + sliceIdx;
    width = sx;
    height = sy;
  }

  const pixelCount = width * height;
  const outRgbaByteLen = pixelCount * 4;
  const outBidsByteLen = pixelCount * 2;
  // 空氣採用深青藍底色，使地下隧道與房間輪廓在 CT 切面上鮮明可辨
  const airRgbaU32 = ((225 << 24) | (58 << 16) | (38 << 8) | 18) >>> 0;

  let gridPtr = 0;
  let rgbaPtr = 0;
  let outRgbaPtr = 0;
  let outBidsPtr = 0;

  try {
    gridPtr = wasm.wasm_alloc(grid.byteLength);
    rgbaPtr = wasm.wasm_alloc(stylesRgba.byteLength);
    outRgbaPtr = wasm.wasm_alloc(outRgbaByteLen);
    outBidsPtr = wasm.wasm_alloc(outBidsByteLen);
    if (!gridPtr || !rgbaPtr || !outRgbaPtr || !outBidsPtr) {
      throw new Error("WASM CT 切面記憶體配置失敗");
    }

    const memBuf0 = wasm.memory.buffer;
    new Uint16Array(memBuf0, gridPtr, grid.length).set(grid);
    new Uint8Array(memBuf0, rgbaPtr, stylesRgba.length).set(stylesRgba);

    const rc = wasm.vxv_slice_2d(
      gridPtr,
      sy,
      sz,
      sx,
      rgbaPtr,
      numStyles,
      axis,
      sliceIdx,
      airRgbaU32,
      outRgbaPtr,
      outBidsPtr
    );
    if (rc !== 0) {
      throw new Error(`WASM CT 切面擷取失敗 (code=${rc})`);
    }

    const memBuf1 = wasm.memory.buffer;
    const rgbaArr = new Uint8Array(memBuf1, outRgbaPtr, outRgbaByteLen).slice();
    const bidsArr = new Uint16Array(memBuf1, outBidsPtr, pixelCount).slice();

    return {
      axis,
      coord: actualCoord,
      width,
      height,
      boxOrigin: [x0, y0, z0],
      paletteNames,
      rgbaBuf: rgbaArr.buffer,
      bidsBuf: bidsArr.buffer,
      transferables: [rgbaArr.buffer, bidsArr.buffer],
    };
  } finally {
    if (outBidsPtr) wasm.wasm_free(outBidsPtr, outBidsByteLen);
    if (outRgbaPtr) wasm.wasm_free(outRgbaPtr, outRgbaByteLen);
    if (rgbaPtr) wasm.wasm_free(rgbaPtr, stylesRgba.byteLength);
    if (gridPtr) wasm.wasm_free(gridPtr, grid.byteLength);
  }
}

self.onmessage = async (e) => {
  const { id, type, ...payload } = e.data;
  try {
    if (type === "prepareBox") {
      const res = await handlePrepareBox(payload);
      self.postMessage({ id, ok: true, ...res });
    } else if (type === "buildFilterMesh") {
      const res = await handleBuildFilterMesh(payload);
      const { transferables, ...rest } = res;
      self.postMessage({ id, ok: true, ...rest }, transferables);
    } else if (type === "extractSlice") {
      const res = await handleExtractSlice(payload);
      const { transferables, ...rest } = res;
      self.postMessage({ id, ok: true, ...rest }, transferables);
    } else if (type === "clearCache") {
      tileCache.clear();
      activeBox = null;
      self.postMessage({ id, ok: true });
    } else {
      throw new Error(`未知分析指令: ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
