import { useCallback, useEffect, useRef, useState } from 'react';

// Sony PaSoRi ベンダー ID
const SONY_VENDOR_ID = 0x054c;

// 既知の PaSoRi 製品 ID
//   0x0dc9 — FeliCa Port/PaSoRi 4.0 (RC-S300/P)  ← CCID + Vendor-Specific dual interface
//   0x0dc8 — RC-S300/S                              ← 同上
//   0x06c3 — RC-S380/P  (Vendor-Specific のみ)
//   0x06c1 — RC-S380/S  (Vendor-Specific のみ)
//   0x0bb7 — RC-S330
//   0x02e1 — RC-S330 (旧)
const PASORI_PRODUCT_IDS = [0x0dc9, 0x0dc8, 0x06c3, 0x06c1, 0x0bb7, 0x02e1];

// RC-S300 系の Product ID
const RC_S300_IDS = new Set([0x0dc8, 0x0dc9]);
// RC-S380 系の Product ID
const RC_S380_IDS = new Set([0x06c1, 0x06c3, 0x0bb7, 0x02e1]);


export type WebUSBStatus = 'idle' | 'connecting' | 'connected' | 'reading' | 'success' | 'error';

export interface WebUSBFeliCaState {
  status: WebUSBStatus;
  idm: string | null;
  errorMessage: string | null;
}

export interface UseWebUSBFeliCaReturn extends WebUSBFeliCaState {
  connect: () => Promise<void>;
  readIdm: () => Promise<string | null>;
  disconnect: () => Promise<void>;
  reset: () => void;
}

// ---- 接続済みデバイスのコンテキスト ----
interface DeviceContext {
  device: USBDevice;
  interfaceNumber: number;
  endpointIn: number;
  endpointOut: number;
}

// ---- ユーティリティ ----

let seqNumber = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function bulkOut(ctx: DeviceContext, data: Uint8Array): Promise<void> {
  const result = await ctx.device.transferOut(ctx.endpointOut, data.buffer as ArrayBuffer);
  if (result.status !== 'ok') throw new Error(`transferOut failed: ${result.status}`);
}

async function bulkIn(ctx: DeviceContext, length: number): Promise<Uint8Array> {
  const result = await ctx.device.transferIn(ctx.endpointIn, length);
  if (result.status !== 'ok' || !result.data) throw new Error(`transferIn failed: ${result.status}`);
  return new Uint8Array(result.data.buffer);
}

/**
 * RC-S300 向け: PC_to_RDR_Escape フレームを送信する。
 * CCID Escape コマンド (0x6B) を 10 バイトヘッダでラップする。
 */
async function send300(ctx: DeviceContext, data: number[]): Promise<void> {
  const payload = new Uint8Array(data);
  const pkt = new Uint8Array(10 + payload.length);
  pkt[0] = 0x6b;
  pkt[1] = payload.length & 0xff;
  pkt[2] = (payload.length >> 8) & 0xff;
  pkt[3] = (payload.length >> 16) & 0xff;
  pkt[4] = (payload.length >> 24) & 0xff;
  pkt[5] = 0x00; // slot
  pkt[6] = ++seqNumber & 0xff;
  // bytes 7-9: reserved = 0x00
  pkt.set(payload, 10);
  await bulkOut(ctx, pkt);
  await sleep(20);
}

async function recv300(ctx: DeviceContext): Promise<Uint8Array> {
  const data = await bulkIn(ctx, 50);
  await sleep(10);
  return data;
}

/**
 * RC-S380 向け: NFC Normal Frame を送信する。
 */
async function send380(ctx: DeviceContext, data: number[]): Promise<void> {
  await bulkOut(ctx, new Uint8Array(data));
  await sleep(10);
}

async function recv380(ctx: DeviceContext, length: number): Promise<Uint8Array> {
  const data = await bulkIn(ctx, length);
  await sleep(10);
  return data;
}

// ---- デバイスセットアップ ----

/**
 * デバイスを開き、適切なインターフェースをクレームして DeviceContext を返す。
 *
 * RC-S300: CCID（class 0x0B）ではなく Vendor-Specific（class 0xFF）インターフェースを使う。
 * RC-S380: configurations[0].interfaces[0] を使う。
 */
async function setupDevice(device: USBDevice): Promise<DeviceContext> {
  await device.open();
  const confValue = device.configurations[0].configurationValue ?? 1;
  await device.selectConfiguration(confValue);

  let interfaceNumber: number;
  let endpointIn: number;
  let endpointOut: number;

  if (RC_S300_IDS.has(device.productId)) {
    // RC-S300: class 0xFF (Vendor-Specific) のインターフェースを選ぶ
    const iface = device.configuration?.interfaces.find(
      (i) => i.alternate.interfaceClass === 0xff,
    );
    if (!iface) throw new Error('RC-S300 の Vendor-Specific インターフェースが見つかりません');
    interfaceNumber = iface.interfaceNumber;
    endpointIn = iface.alternate.endpoints.find((e) => e.direction === 'in')!.endpointNumber;
    endpointOut = iface.alternate.endpoints.find((e) => e.direction === 'out')!.endpointNumber;
  } else {
    // RC-S380 / 旧モデル: 最初のインターフェースの bulk エンドポイントを使う
    const iface = device.configurations[0].interfaces[0];
    interfaceNumber = iface.interfaceNumber;
    endpointIn = iface.alternate.endpoints.find(
      (e) => e.direction === 'in' && e.type === 'bulk',
    )!.endpointNumber;
    endpointOut = iface.alternate.endpoints.find(
      (e) => e.direction === 'out' && e.type === 'bulk',
    )!.endpointNumber;
  }

  await device.claimInterface(interfaceNumber);
  return { device, interfaceNumber, endpointIn, endpointOut };
}

// ---- IDm 読み取り ----

/**
 * RC-S300 向け FeliCa Polling で IDm を取得する。
 * pasorich (con3code) の send300 プロトコルを参照。
 */
async function pollFeliCa300(ctx: DeviceContext): Promise<string | null> {
  // endtransparent
  await send300(ctx, [0xff, 0x50, 0x00, 0x00, 0x02, 0x82, 0x00, 0x00]);
  await recv300(ctx);
  // startransparent
  await send300(ctx, [0xff, 0x50, 0x00, 0x00, 0x02, 0x81, 0x00, 0x00]);
  await recv300(ctx);
  // RF off
  await send300(ctx, [0xff, 0x50, 0x00, 0x00, 0x02, 0x83, 0x00, 0x00]);
  await recv300(ctx);
  // RF on
  await send300(ctx, [0xff, 0x50, 0x00, 0x00, 0x02, 0x84, 0x00, 0x00]);
  await recv300(ctx);
  // SwitchProtocolTypeF
  await send300(ctx, [0xff, 0x50, 0x00, 0x02, 0x04, 0x8f, 0x02, 0x03, 0x00, 0x00]);
  await recv300(ctx);
  // FeliCa Polling (System Code FF FF)
  await send300(ctx, [
    0xff, 0x50, 0x00, 0x01, 0x00, 0x00, 0x11, 0x5f, 0x46, 0x04,
    0xa0, 0x86, 0x01, 0x00, 0x95, 0x82, 0x00, 0x06, 0x06, 0x00,
    0xff, 0xff, 0x01, 0x00, 0x00, 0x00, 0x00,
  ]);
  const resp = await recv300(ctx);

  // レスポンスが 34 バイトあれば offset 26〜33 が IDm (8 bytes)
  if (resp.length >= 34) {
    const idmBytes = resp.slice(26, 34);
    if (idmBytes.some((b) => b !== 0)) {
      return Array.from(idmBytes)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join('');
    }
  }
  return null;
}

/**
 * RC-S380 向け FeliCa Polling で IDm を取得する。
 * pasorich の RC-S380 session を参照。
 */
async function pollFeliCa380(ctx: DeviceContext): Promise<string | null> {
  await send380(ctx, [0x00, 0x00, 0xff, 0x00, 0xff, 0x00]);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x03, 0x00, 0xfd, 0xd6, 0x2a, 0x01, 0xff, 0x00]); // SetCommandType
  await recv380(ctx, 6);
  await recv380(ctx, 13);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x03, 0x00, 0xfd, 0xd6, 0x06, 0x00, 0x24, 0x00]); // SwitchRF
  await recv380(ctx, 6);
  await recv380(ctx, 13);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x03, 0x00, 0xfd, 0xd6, 0x06, 0x00, 0x24, 0x00]); // SwitchRF
  await recv380(ctx, 6);
  await recv380(ctx, 13);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x06, 0x00, 0xfa, 0xd6, 0x00, 0x01, 0x01, 0x0f, 0x01, 0x18, 0x00]); // InSetRF
  await recv380(ctx, 6);
  await recv380(ctx, 13);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x28, 0x00, 0xd8, 0xd6, 0x02, 0x00, 0x18, 0x01, 0x01, 0x02, 0x01, 0x03, 0x00, 0x04, 0x00, 0x05, 0x00, 0x06, 0x00, 0x07, 0x08, 0x08, 0x00, 0x09, 0x00, 0x0a, 0x00, 0x0b, 0x00, 0x0c, 0x00, 0x0e, 0x04, 0x0f, 0x00, 0x10, 0x00, 0x11, 0x00, 0x12, 0x00, 0x13, 0x06, 0x4b, 0x00]); // InSetProtocol
  await recv380(ctx, 6);
  await recv380(ctx, 13);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x04, 0x00, 0xfc, 0xd6, 0x02, 0x00, 0x18, 0x10, 0x00]); // InSetProtocol
  await recv380(ctx, 6);
  await recv380(ctx, 13);
  await send380(ctx, [0x00, 0x00, 0xff, 0xff, 0xff, 0x0a, 0x00, 0xf6, 0xd6, 0x04, 0x6e, 0x00, 0x06, 0x00, 0xff, 0xff, 0x01, 0x00, 0xb3, 0x00]); // InCommRF
  await recv380(ctx, 6);

  const resp = await recv380(ctx, 37);
  // IDm: offset 17〜24
  const idmBytes = Array.from(resp).slice(17, 25);
  if (idmBytes.length === 8 && idmBytes.some((b) => b !== 0)) {
    return idmBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  }
  return null;
}

async function pollFeliCa(ctx: DeviceContext): Promise<string | null> {
  if (RC_S300_IDS.has(ctx.device.productId)) {
    return pollFeliCa300(ctx);
  }
  if (RC_S380_IDS.has(ctx.device.productId)) {
    return pollFeliCa380(ctx);
  }
  // 不明モデルは RC-S380 プロトコルで試みる
  return pollFeliCa380(ctx);
}

// ---- フック本体 ----

/**
 * Sony PaSoRi (RC-S380 / RC-S300 系) を WebUSB 経由で制御し FeliCa IDm を読み取るカスタムフック。
 *
 * - RC-S300/P (0x0DC9) / RC-S300/S (0x0DC8): Vendor-Specific インターフェース (class 0xFF) を使用
 * - RC-S380/P (0x06C3) / RC-S380/S (0x06C1): 最初のバルクインターフェースを使用
 */
export function useWebUSBFeliCa(): UseWebUSBFeliCaReturn {
  const ctxRef = useRef<DeviceContext | null>(null);
  const [state, setState] = useState<WebUSBFeliCaState>({
    status: 'idle',
    idm: null,
    errorMessage: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const setStatus = useCallback(
    (status: WebUSBStatus, extra?: Partial<Omit<WebUSBFeliCaState, 'status'>>) => {
      setState((prev) => ({ ...prev, status, ...extra }));
    },
    [],
  );

  const connect = useCallback(async () => {
    setStatus('connecting', { errorMessage: null });
    try {
      const device = await navigator.usb.requestDevice({
        filters: PASORI_PRODUCT_IDS.map((productId) => ({ vendorId: SONY_VENDOR_ID, productId })),
      });
      const ctx = await setupDevice(device);
      ctxRef.current = ctx;
      setStatus('connected', { errorMessage: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No device selected') || msg.includes('cancelled')) {
        setStatus('idle', { errorMessage: null });
      } else if (msg.includes('protected class')) {
        setStatus('error', {
          errorMessage:
            'このデバイスは WebUSB に非対応です（CCIDクラス保護）。RC-S380 または RC-S300 の Vendor-Specific インターフェースが利用できません。',
        });
      } else {
        setStatus('error', { errorMessage: `接続に失敗しました: ${msg}` });
      }
    }
  }, [setStatus]);

  const disconnect = useCallback(async () => {
    const ctx = ctxRef.current;
    if (ctx) {
      try {
        await ctx.device.releaseInterface(ctx.interfaceNumber);
        await ctx.device.close();
      } catch {
        // 切断エラーは無視
      }
      ctxRef.current = null;
    }
    setStatus('idle', { idm: null, errorMessage: null });
  }, [setStatus]);

  const readIdm = useCallback(async (): Promise<string | null> => {
    const ctx = ctxRef.current;
    if (!ctx) {
      setStatus('error', { errorMessage: 'PaSoRi が接続されていません' });
      return null;
    }
    setStatus('reading', { errorMessage: null });
    try {
      while (ctxRef.current === ctx && stateRef.current.status === 'reading') {
        const idm = await pollFeliCa(ctx);
        if (idm) {
          setStatus('success', { idm, errorMessage: null });
          return idm;
        }
        await sleep(300);
      }
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await disconnect();
      setStatus('error', { errorMessage: `読み取りに失敗しました: ${msg}` });
      return null;
    }
  }, [disconnect, setStatus]);

  const reset = useCallback(() => {
    setState({ status: ctxRef.current ? 'connected' : 'idle', idm: null, errorMessage: null });
  }, []);

  // USBデバイスの脱着イベントの監視
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.usb) return;

    const handleDisconnect = (event: USBConnectionEvent) => {
      if (ctxRef.current && ctxRef.current.device === event.device) {
        console.log('[useWebUSBFeliCa] Device disconnected:', event.device);
        disconnect();
      }
    };

    const handleConnect = async (event: USBConnectionEvent) => {
      const isPasori =
        event.device.vendorId === SONY_VENDOR_ID &&
        PASORI_PRODUCT_IDS.includes(event.device.productId);

      if (!ctxRef.current && isPasori) {
        console.log('[useWebUSBFeliCa] PaSoRi connected, attempting auto-connect:', event.device);
        setStatus('connecting', { errorMessage: null });
        try {
          const ctx = await setupDevice(event.device);
          ctxRef.current = ctx;
          setStatus('connected', { errorMessage: null });
        } catch (err) {
          console.error('[useWebUSBFeliCa] Auto-connect failed:', err);
          ctxRef.current = null;
          setStatus('idle');
        }
      }
    };

    navigator.usb.addEventListener('disconnect', handleDisconnect);
    navigator.usb.addEventListener('connect', handleConnect);

    return () => {
      navigator.usb.removeEventListener('disconnect', handleDisconnect);
      navigator.usb.removeEventListener('connect', handleConnect);
    };
  }, [disconnect, setStatus]);

  // 初期マウント時にすでにペアリング済みのデバイスが接続されていれば自動接続する
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.usb) return;

    let isMounted = true;

    const attemptAutoConnect = async () => {
      if (ctxRef.current) return;

      try {
        const devices = await navigator.usb.getDevices();
        const pasoriDevice = devices.find(
          (d) =>
            d.vendorId === SONY_VENDOR_ID &&
            PASORI_PRODUCT_IDS.includes(d.productId)
        );

        if (pasoriDevice && isMounted && !ctxRef.current) {
          console.log('[useWebUSBFeliCa] Found paired PaSoRi device on mount, auto-connecting...');
          setStatus('connecting', { errorMessage: null });
          const ctx = await setupDevice(pasoriDevice);
          if (isMounted) {
            ctxRef.current = ctx;
            setStatus('connected', { errorMessage: null });
          } else {
            try {
              await ctx.device.releaseInterface(ctx.interfaceNumber);
              await ctx.device.close();
            } catch {}
          }
        }
      } catch (err) {
        console.error('[useWebUSBFeliCa] Mount auto-connect failed:', err);
        if (isMounted) {
          setStatus('idle');
        }
      }
    };

    attemptAutoConnect();

    return () => {
      isMounted = false;
    };
  }, [setStatus]);

  return { ...state, connect, readIdm, disconnect, reset };
}
