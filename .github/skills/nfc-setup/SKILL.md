---
name: nfc-setup
description: "Windowsデスクトップ打刻アプリのセットアップ。Use when setting up the Windows desktop NFC app with PaSoRi, configuring nfcpy, building PySide6 UI, packaging with PyInstaller, or troubleshooting NFC reader connectivity."
argument-hint: "デスクトップアプリに関する作業内容を記述してください"
---

# Windows デスクトップ打刻アプリ セットアップ

## いつ使うか
- Windows デスクトップアプリの初期セットアップ
- nfcpy + PaSoRi の接続設定
- PySide6 UI の実装
- PyInstaller での exe ビルド
- NFC リーダー接続の問題解決

## 前提条件

- Windows 10/11
- Python 3.12+
- Sony PaSoRi (RC-S380 / RC-S300)
- nfcpy, PySide6, httpx, PyInstaller

## PaSoRi デバイス情報

| モデル | Vendor ID | Product ID |
|--------|-----------|------------|
| RC-S380 | 054C | 06C3 |
| RC-S300 | 054C | 06C1 |

## 開発環境セットアップ

```bash
cd desktop
pip install -e ".[dev]"

# nfcpy でリーダー検出確認
python -m nfc
```

## NFC 読み取り実装

```python
# desktop/src/kint_desktop/nfc/reader.py
import nfc
from collections.abc import Callable

class PaSoRiReader:
    """。PaSoRiでFeliCa IDmを読み取る。"""

    def __init__(self, device: str = "usb") -> None:
        self.device = device
        self._on_idm: Callable[[str], None] | None = None

    def on_connect(self, tag: nfc.tag.Tag) -> bool:
        idm = tag.identifier.hex().upper()
        if self._on_idm:
            self._on_idm(idm)
        return True

    def start(self, on_idm: Callable[[str], None]) -> None:
        self._on_idm = on_idm
        with nfc.ContactlessFrontend(self.device) as clf:
            clf.connect(rdwr={"on-connect": self.on_connect})
```

## PySide6 UI パターン

```python
# desktop/src/kint_desktop/ui/punch_view.py
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel
from PySide6.QtCore import Signal

class PunchView(QWidget):
    """NFC打刻画面。"""
    punch_requested = Signal(str)  # IDm

    def __init__(self) -> None:
        super().__init__()
        layout = QVBoxLayout(self)
        self.status_label = QLabel("カードをタッチしてください")
        layout.addWidget(self.status_label)

    def on_card_detected(self, idm: str) -> None:
        self.status_label.setText(f"読み取り: {idm}")
        self.punch_requested.emit(idm)
```

## PyInstaller exe ビルド

```bash
# Windows 環境で実行
cd desktop
pyinstaller build.spec
# dist/kint_desktop.exe が生成される
```

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| リーダーが検出されない | ドライバの問題 | Windows デバイスマネージャーで確認、WinUSBドライバーをインストール |
| `usb:XXX:YYY` で接続不可 | 他アプリが占有 | 他のNFCアプリを閉じる |
| カード読み取りが不安定 | 電力不足 | セルフパワーUSBハブを使用 |
| API接続エラー | サーバーURL設定誤り | `config.py` の接続先を確認 |
| exeが起動しない | 依存関係の不足 | PyInstaller の build.spec を確認 |
