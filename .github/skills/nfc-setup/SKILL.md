---
name: nfc-setup
description: "WebUSB + PaSoRi による NFC 読み取りのセットアップ。Use when setting up WebUSB communication with PaSoRi, implementing FeliCa IDm reading in the browser, or troubleshooting NFC reader connectivity."
argument-hint: "WebUSB / NFC に関する作業内容を記述してください"
---

# WebUSB + PaSoRi NFC セットアップ

## いつ使うか
- WebUSB による PaSoRi 接続の初期実装
- FeliCa Polling / IDm 読み取りロジックの実装
- NFC リーダー接続の問題解決
- React フック (`useNfcReader`) の実装

## 前提条件

- Chrome / Edge（最新安定版）— WebUSB 対応ブラウザ
- HTTPS 環境（開発時は `localhost` で可）
- Sony PaSoRi (RC-S380 / RC-S300)

## PaSoRi デバイス情報

| モデル | Vendor ID | Product ID |
|--------|-----------|------------|
| RC-S380 | 0x054C | 0x06C3 |
| RC-S300 | 0x054C | 0x06C1 |

## ディレクトリ構成

```
frontend/src/nfc/
├── pasori.ts          # WebUSB デバイス接続・低レベル通信
├── felica.ts          # FeliCa Polling コマンド・IDm パース
├── types.ts           # NFC 関連の型定義
└── errors.ts          # NFC エラークラス
frontend/src/hooks/
└── useNfcReader.ts    # React フック
```

## WebUSB 接続パターン

```typescript
// frontend/src/nfc/pasori.ts
const PASORI_FILTERS: USBDeviceFilter[] = [
  { vendorId: 0x054c, productId: 0x06c3 }, // RC-S380
  { vendorId: 0x054c, productId: 0x06c1 }, // RC-S300
];

export async function connectPaSoRi(): Promise<USBDevice> {
  const device = await navigator.usb.requestDevice({ filters: PASORI_FILTERS });
  await device.open();
  await device.selectConfiguration(1);
  await device.claimInterface(0);
  return device;
}
```

## React フックパターン

```typescript
// frontend/src/hooks/useNfcReader.ts
import { useState, useCallback } from 'react';
import { connectPaSoRi, readIdm } from '../nfc/pasori';

type NfcStatus = 'disconnected' | 'connecting' | 'ready' | 'reading' | 'error';

export function useNfcReader() {
  const [status, setStatus] = useState<NfcStatus>('disconnected');
  const [device, setDevice] = useState<USBDevice | null>(null);

  const connect = useCallback(async () => {
    setStatus('connecting');
    try {
      const dev = await connectPaSoRi();
      setDevice(dev);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  const read = useCallback(async (): Promise<string | null> => {
    if (!device) return null;
    setStatus('reading');
    try {
      const idm = await readIdm(device);
      setStatus('ready');
      return idm;
    } catch {
      setStatus('error');
      return null;
    }
  }, [device]);

  return { status, connect, read } as const;
}
```

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `navigator.usb` が undefined | 非対応ブラウザ or HTTP | Chrome/Edge + HTTPS (localhost可) で確認 |
| デバイス選択で PaSoRi が出ない | ドライバの問題 | OS のデバイスマネージャーで確認、他アプリが占有していないか確認 |
| `SecurityError` が発生 | ユーザージェスチャー不足 | `requestDevice()` はボタンクリック等のユーザー操作内で呼ぶ |
| カード読み取りが不安定 | 電力不足 | セルフパワー USB ハブを使用 |
| `NetworkError: Unable to claim interface` | 他プロセスが占有 | 他の NFC アプリを閉じてリトライ |
| 非対応ブラウザ (Firefox/Safari) | WebUSB 未実装 | Chrome / Edge を使用する |
