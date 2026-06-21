import { useState, useEffect, useRef } from 'react';
import './UserManagementPage.css'; // 既存スタイルと統合

interface UserManagementGuideModalProps {
  onClose: () => void;
}

type TabType = 'register' | 'nfc' | 'delete' | 'trouble';

export function UserManagementGuideModal({ onClose }: UserManagementGuideModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('register');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="myprofile-dialog user-guide-dialog"
      onCancel={onClose}
      onClick={handleBackdropClick}
      style={{
        maxWidth: '850px',
        width: '90%',
        borderRadius: '16px',
        border: 'none',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        background: '#ffffff',
        padding: 0,
        overflow: 'hidden'
      }}
    >
      <div className="user-guide-container" style={{ display: 'flex', flexDirection: 'column', height: '80vh', maxHeight: '650px' }}>
        {/* ヘッダー */}
        <div className="user-guide-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#ffffff'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📖</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
              ユーザー管理画面 使い方ガイド
            </h2>
          </div>
          <button
            type="button"
            className="myprofile-dialog__close"
            aria-label="閉じる"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'background 0.2s',
              fontSize: '0.9rem'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)')}
          >
            ✕
          </button>
        </div>

        {/* メインレイアウト（左タブ、右コンテンツ） */}
        <div className="user-guide-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 左サイドバー（タブナビゲーション） */}
          <div className="user-guide-sidebar" style={{
            width: '220px',
            background: '#f8fafc',
            borderRight: '1px solid #e2e8f0',
            padding: '1rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('register')}
              className={`guide-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'register' ? '#e0e7ff' : 'transparent',
                color: activeTab === 'register' ? '#4338ca' : '#475569',
                fontWeight: activeTab === 'register' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>👤</span> ユーザー新規登録
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('nfc')}
              className={`guide-tab-btn ${activeTab === 'nfc' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'nfc' ? '#e0e7ff' : 'transparent',
                color: activeTab === 'nfc' ? '#4338ca' : '#475569',
                fontWeight: activeTab === 'nfc' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>💳</span> NFCカードの登録
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('delete')}
              className={`guide-tab-btn ${activeTab === 'delete' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'delete' ? '#e0e7ff' : 'transparent',
                color: activeTab === 'delete' ? '#4338ca' : '#475569',
                fontWeight: activeTab === 'delete' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>⚠️</span> 削除と完全削除
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('trouble')}
              className={`guide-tab-btn ${activeTab === 'trouble' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'trouble' ? '#e0e7ff' : 'transparent',
                color: activeTab === 'trouble' ? '#4338ca' : '#475569',
                fontWeight: activeTab === 'trouble' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>🔧</span> その他・トラブル
            </button>
          </div>

          <div className="user-guide-content" style={{
            flex: 1,
            padding: '1.5rem 2rem',
            overflowY: 'auto',
            background: '#ffffff',
            lineHeight: '1.6',
            color: '#334155',
            textAlign: 'left'
          }}>
            {activeTab === 'register' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  👤 従業員を新規登録する
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  新しく従業員や管理者をシステムに追加する手順は以下の通りです。
                </p>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    画面右上の <strong>「+ ユーザー登録」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    表示される入力フォームに必要な情報を入力します。
                    <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem' }}>
                      <li><strong>表示名</strong>: 画面上で確認するための名前（最大50文字）</li>
                      <li><strong>氏名</strong>: 給与申請用のフルネーム（本名、最大100文字）</li>
                      <li><strong>メールアドレス</strong>: シフト管理等で使用する連絡先</li>
                      <li><strong>ロール</strong>: 「従業員」または「管理者」を選択</li>
                    </ul>
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>「保存」</strong> ボタンをクリックして完了します。
                  </li>
                </ol>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#eff6ff',
                  borderLeft: '4px solid #3b82f6',
                  fontSize: '0.85rem',
                  color: '#1e40af',
                  marginTop: '1.5rem'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>💡 アカウントIDについて</strong>
                  ユーザー登録時にアカウントIDを設定する項目はありません。入力された<strong>メールアドレス</strong>が自動的にシステム内のアカウントIDとなり、一意の識別子として使用されます。
                </div>
              </div>
            )}

            {activeTab === 'nfc' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  💳 従業員にNFCカード（FeliCa IDm）を登録する
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  打刻に使用するICカード（交通系ICカード、社員証など）をユーザーに登録・紐付けします。
                </p>

                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: '#fffbeb',
                  borderLeft: '4px solid #d97706',
                  fontSize: '0.85rem',
                  color: '#92400e',
                  marginBottom: '1.25rem'
                }}>
                  ⚠️ <strong>推奨動作環境</strong>: NFCカードの読み取り（WebUSB機能）は、<strong>Google Chrome</strong> または <strong>Microsoft Edge</strong> などの WebUSB 対応ブラウザでのみ動作します。SafariやFirefoxでは動作しません。
                </div>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#334155', margin: '1rem 0 0.5rem 0' }}>登録手順:</h4>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    対象ユーザーの行にある <strong>「カード」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    モーダルの「カードを新規登録」セクションで、<strong>「接続」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    ブラウザ上部に機器選択ポップアップが表示されるので、接続されている <strong>「PaSoRi (RC-S380/RC-S300)」</strong> を選んで接続します。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    ステータスが <strong>「カードをかざしてください」</strong> に切り替わったら、リーダーにカードを乗せます。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    読み取り成功後、任意で<strong>カード名</strong>を入力し、<strong>「このカードを登録」</strong> ボタンをクリックします。
                  </li>
                </ol>
              </div>
            )}

            {activeTab === 'delete' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  ⚠️ ユーザーの「削除（非有効化）」と「完全削除」
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  退職や運用停止に伴うユーザー削除には、データの保持レベルに応じて2つのステップがあります。
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#475569', fontSize: '0.95rem', fontWeight: '600' }}>
                      🚫 削除（非有効化 / 論理削除）
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>
                      対象ユーザーの「削除」ボタンを押すと、アカウントが「無効」状態になります。無効化されたユーザーは打刻やログインができなくなりますが、<strong>過去の出退勤履歴、シフト、登録済みカードなどのデータは安全にデータベースに残ります。</strong> 後からいつでも「有効」に戻せます。
                    </p>
                  </div>

                  <div style={{ padding: '1rem', borderRadius: '8px', border: '1px solid #fee2e2', background: '#fef2f2' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#991b1b', fontSize: '0.95rem', fontWeight: '600' }}>
                      💀 完全削除（物理削除）
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#7f1d1d' }}>
                      すでに「無効」になっているユーザーにのみ「完全削除」ボタンが表示されます。この操作を行うと、ユーザーの出退勤履歴、カードデータ、シフトを含む<strong>すべての関連データがデータベースから永久に消去され、復旧できなくなります。</strong>
                    </p>
                  </div>
                </div>

                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  borderLeft: '4px solid #64748b',
                  fontSize: '0.85rem',
                  color: '#334155'
                }}>
                  🔒 <strong>システムアカウントの保護</strong>: システム内部で監査ログの記録等に使用される <strong>`system` ユーザー</strong> は、誤って削除・完全削除されないよう制限がかかっており、UI上で削除ボタンは非表示になっています。
                </div>
              </div>
            )}

            {activeTab === 'trouble' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🔧 その他・トラブルシューティング
                </h3>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '0 0 0.5rem 0' }}>
                  💾 データのバックアップと復元
                </h4>
                <ul style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>一括保存 (JSON)</strong>: 登録されている全ユーザー情報をJSON形式でPCにダウンロードします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>一括復元</strong>: エクスポートしたJSONを読み込みます。既存のユーザー（メールアドレスが一致）は最新情報で上書きされ、存在しないユーザーは新規追加されます。
                  </li>
                </ul>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>
                  ⚡️ PaSoRiでカードが読み取れない場合
                </h4>
                <ul style={{ paddingLeft: '1.25rem', marginBottom: '0', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>ブラウザの確認</strong>: SafariやFirefoxではWebUSBが使えません。ChromeかEdgeを使用してください。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>接続の確認</strong>: USBハブ経由ではなく、パソコン本体のUSBポートに直接接続してください。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>他アプリの競合</strong>: SFCard Viewer など、他のICカード読取ソフトが起動している場合は終了させてください。
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="user-guide-footer" style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
            style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', fontSize: '0.9rem', cursor: 'pointer' }}
          >
            閉じる
          </button>
        </div>
      </div>
    </dialog>
  );
}
