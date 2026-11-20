// 背景 Web Worker：負責跨網域串流下載 .vxq.gz、相容 VXQ1/VXQ2 並呼叫同網域 vxq_wasm.wasm 解析

let wasmReady = null;
const textDecoder = new TextDecoder();

async function ensureWasm() {
  if (wasmReady) return wasmReady;
  wasmReady = (async () => {
    const res = await fetch("../wasm/vxq_wasm.wasm");
    if (!res.ok) throw new Error(`載入 vxq_wasm.wasm 失敗 (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buf, {});
    return instance.exports;
  })().catch((err) => {
    // 若載入或實例化失敗則清除快取，讓後續請求得以重試
    wasmReady = null;
    throw err;
  });
  return wasmReady;
}

function isGzipMagic(u8) {
  return u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}

function isVxqMagic(u8) {
  return (
    u8.length >= 4 &&
    u8[0] === 0x56 &&
    u8[1] === 0x58 &&
    u8[2] === 0x51 &&
    (u8[3] === 0x31 || u8[3] === 0x32) // "VXQ1" 或 "VXQ2"
  );
}

function align4(n) {
  return (n + 3) & ~3;
}

self.onmessage = async (e) => {
  const { id, url, gzip } = e.data;
  try {
    const [wasm, res] = await Promise.all([
      ensureWasm(),
      fetch(url, { mode: "cors" }),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const fetchedBuf = await res.arrayBuffer();
    const fetchedBytes = new Uint8Array(fetchedBuf);

    // 防止 CDN/Nginx 已自動加掛 Content-Encoding: gzip 導致二次解壓錯誤
    let rawBuf;
    if (isVxqMagic(fetchedBytes)) {
      rawBuf = fetchedBuf;
    } else if (gzip || isGzipMagic(fetchedBytes)) {
      const ds = new DecompressionStream("gzip");
      const decompressed = new Response(fetchedBuf).body.pipeThrough(ds);
      rawBuf = await new Response(decompressed).arrayBuffer();
    } else {
      rawBuf = fetchedBuf;
    }

    const bytes = new Uint8Array(rawBuf);
    let dataPtr = 0;
    let infoPtr = 0;
    let outPtr = 0;
    let outBytes = 0;

    try {
      dataPtr = wasm.wasm_alloc(bytes.length);
      infoPtr = wasm.wasm_alloc(44); // 11 * u32
      if (!dataPtr || !infoPtr) {
        throw new Error("WASM 記憶體配置失敗");
      }
      new Uint8Array(wasm.memory.buffer, dataPtr, bytes.length).set(bytes);

      const hrc = wasm.vxq_header_info(dataPtr, bytes.length, infoPtr);
      if (hrc !== 0) {
        throw new Error(`VXQ 表頭驗證失敗 (code=${hrc})`);
      }

      const infoU32 = new Uint32Array(wasm.memory.buffer, infoPtr, 10);
      const infoF32 = new Float32Array(wasm.memory.buffer, infoPtr + 24, 3);
      const version = infoU32[0];
      const solidCount = infoU32[1];
      const transCount = infoU32[2];
      const namesOff = infoU32[4];
      const namesLen = infoU32[5];
      const tileOffset = [infoF32[0], infoF32[1], infoF32[2]];

      if (version === 1) {
        const rc = wasm.vxq_inspect(dataPtr, bytes.length, infoPtr);
        if (rc !== 0) {
          throw new Error(`VXQ1 驗證失敗 (code=${rc})`);
        }
        const metaU32 = new Uint32Array(wasm.memory.buffer, infoPtr, 11);
        const aabb = [
          metaU32[2], metaU32[3], metaU32[4],
          metaU32[5], metaU32[6], metaU32[7],
        ];
        const solidByteOffset = 32;
        const transByteOffset = 32 + solidCount * 12;

        const solidArr = solidCount > 0
          ? new Uint32Array(rawBuf, solidByteOffset, solidCount * 3).slice()
          : new Uint32Array(0);
        const transArr = transCount > 0
          ? new Uint32Array(rawBuf, transByteOffset, transCount * 3).slice()
          : new Uint32Array(0);

        self.postMessage(
          {
            id,
            ok: true,
            version: 1,
            solidCount,
            transCount,
            aabb,
            tileOffset,
            rawBytes: rawBuf.byteLength,
            solidBuf: solidArr.buffer,
            transBuf: transArr.buffer,
            solidBidsBuf: null,
            transBidsBuf: null,
            palette: null,
          },
          [solidArr.buffer, transArr.buffer]
        );
        return;
      }

      // VXQ2 解包並還原為 GPU 12B/quad 與方塊索引陣列
      const palette = namesLen > 0
        ? textDecoder.decode(bytes.subarray(namesOff, namesOff + namesLen)).split("\n")
        : [];

      const aabbOff = 0;
      const solidQOff = 24;
      const solidBOff = solidQOff + solidCount * 12;
      const transQOff = solidBOff + align4(solidCount * 2);
      const transBOff = transQOff + transCount * 12;
      outBytes = Math.max(24, transBOff + align4(transCount * 2));

      outPtr = wasm.wasm_alloc(outBytes);
      if (!outPtr) {
        throw new Error("WASM VXQ2 輸出緩衝區配置失敗");
      }

      const rc2 = wasm.vxq_unpack_v2(
        dataPtr,
        bytes.length,
        outPtr + aabbOff,
        solidCount > 0 ? outPtr + solidQOff : 0,
        solidCount > 0 ? outPtr + solidBOff : 0,
        transCount > 0 ? outPtr + transQOff : 0,
        transCount > 0 ? outPtr + transBOff : 0
      );
      if (rc2 !== 0) {
        throw new Error(`VXQ2 解包失敗 (code=${rc2})`);
      }

      const memBuf = wasm.memory.buffer;
      const aabbU32 = new Uint32Array(memBuf, outPtr + aabbOff, 6);
      const aabb = [
        aabbU32[0], aabbU32[1], aabbU32[2],
        aabbU32[3], aabbU32[4], aabbU32[5],
      ];

      const solidArr = solidCount > 0
        ? new Uint32Array(memBuf, outPtr + solidQOff, solidCount * 3).slice()
        : new Uint32Array(0);
      const solidBidsArr = solidCount > 0
        ? new Uint16Array(memBuf, outPtr + solidBOff, solidCount).slice()
        : new Uint16Array(0);
      const transArr = transCount > 0
        ? new Uint32Array(memBuf, outPtr + transQOff, transCount * 3).slice()
        : new Uint32Array(0);
      const transBidsArr = transCount > 0
        ? new Uint16Array(memBuf, outPtr + transBOff, transCount).slice()
        : new Uint16Array(0);

      self.postMessage(
        {
          id,
          ok: true,
          version: 2,
          solidCount,
          transCount,
          aabb,
          tileOffset,
          rawBytes: solidCount * 12 + transCount * 12 + 32,
          solidBuf: solidArr.buffer,
          transBuf: transArr.buffer,
          solidBidsBuf: solidBidsArr.buffer,
          transBidsBuf: transBidsArr.buffer,
          palette,
        },
        [solidArr.buffer, transArr.buffer, solidBidsArr.buffer, transBidsArr.buffer]
      );
    } finally {
      if (outPtr) wasm.wasm_free(outPtr, outBytes);
      if (dataPtr) wasm.wasm_free(dataPtr, bytes.length);
      if (infoPtr) wasm.wasm_free(infoPtr, 44);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
