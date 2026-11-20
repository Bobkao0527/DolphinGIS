// 背景 Web Worker：負責跨網域串流下載 .vxq.gz、自動判斷 gzip/VXQ1 標頭並呼叫同網域 vxq_wasm.wasm 解析

let wasmReady = null;

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
  return u8.length >= 4 && u8[0] === 0x56 && u8[1] === 0x58 && u8[2] === 0x51 && u8[3] === 0x31; // "VXQ1"
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
    let metaPtr = 0;

    try {
      dataPtr = wasm.wasm_alloc(bytes.length);
      metaPtr = wasm.wasm_alloc(44); // 11 * u32
      if (!dataPtr || !metaPtr) {
        throw new Error("WASM 記憶體配置失敗");
      }
      new Uint8Array(wasm.memory.buffer, dataPtr, bytes.length).set(bytes);
      const rc = wasm.vxq_inspect(dataPtr, bytes.length, metaPtr);
      if (rc !== 0) {
        throw new Error(`VXQ1 驗證失敗 (code=${rc})`);
      }

      const metaU32 = new Uint32Array(wasm.memory.buffer, metaPtr, 11);
      const metaF32 = new Float32Array(wasm.memory.buffer, metaPtr + 32, 3);

      const solidCount = metaU32[0];
      const transCount = metaU32[1];
      const aabb = [
        metaU32[2], metaU32[3], metaU32[4],
        metaU32[5], metaU32[6], metaU32[7],
      ];
      const tileOffset = [metaF32[0], metaF32[1], metaF32[2]];

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
          solidCount,
          transCount,
          aabb,
          tileOffset,
          rawBytes: rawBuf.byteLength,
          solidBuf: solidArr.buffer,
          transBuf: transArr.buffer,
        },
        [solidArr.buffer, transArr.buffer]
      );
    } finally {
      if (dataPtr) wasm.wasm_free(dataPtr, bytes.length);
      if (metaPtr) wasm.wasm_free(metaPtr, 44);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
