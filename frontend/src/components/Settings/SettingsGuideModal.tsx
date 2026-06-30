import { useState, useEffect, useRef } from 'react';
import './SettingsPage.css';

interface SettingsGuideModalProps {
  onClose: () => void;
}

type TabType = 'general' | 'calendar' | 'notification' | 'backup' | 'device';

export function SettingsGuideModal({ onClose }: SettingsGuideModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('general');
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
      className="settings-guide-dialog"
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
      <div className="settings-guide-container" style={{ display: 'flex', flexDirection: 'column', height: '80vh', maxHeight: '650px' }}>
        {/* ヘッダー */}
        <div className="settings-guide-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
          color: '#ffffff'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📖</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
              システム設定 使い方ガイド
            </h2>
          </div>
          <button
            type="button"
            className="settings-guide-close-btn"
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
        <div className="settings-guide-body" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* 左サイドバー（タブナビゲーション） */}
          <div className="settings-guide-sidebar" style={{
            width: '240px',
            background: '#f8fafc',
            borderRight: '1px solid #e2e8f0',
            padding: '1rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`guide-tab-btn ${activeTab === 'general' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'general' ? '#dbeafe' : 'transparent',
                color: activeTab === 'general' ? '#1d4ed8' : '#475569',
                fontWeight: activeTab === 'general' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>⚙️</span> 一般・打刻規則
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`guide-tab-btn ${activeTab === 'calendar' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'calendar' ? '#dbeafe' : 'transparent',
                color: activeTab === 'calendar' ? '#1d4ed8' : '#475569',
                fontWeight: activeTab === 'calendar' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>📅</span> シフトカレンダー
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('notification')}
              className={`guide-tab-btn ${activeTab === 'notification' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'notification' ? '#dbeafe' : 'transparent',
                color: activeTab === 'notification' ? '#1d4ed8' : '#475569',
                fontWeight: activeTab === 'notification' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>✉️</span> 月次レポート通知
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('backup')}
              className={`guide-tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'backup' ? '#dbeafe' : 'transparent',
                color: activeTab === 'backup' ? '#1d4ed8' : '#475569',
                fontWeight: activeTab === 'backup' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>💾</span> バックアップ・復元
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('device')}
              className={`guide-tab-btn ${activeTab === 'device' ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                border: 'none',
                borderRadius: '8px',
                background: activeTab === 'device' ? '#dbeafe' : 'transparent',
                color: activeTab === 'device' ? '#1d4ed8' : '#475569',
                fontWeight: activeTab === 'device' ? '600' : '500',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '0.9rem'
              }}
            >
              <span>🔒</span> 打刻端末制限と登録
            </button>
          </div>

          <div className="settings-guide-content" style={{
            flex: 1,
            padding: '1.5rem 2rem',
            overflowY: 'auto',
            background: '#ffffff',
            lineHeight: '1.6',
            color: '#334155',
            textAlign: 'left'
          }}>
            {activeTab === 'general' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  ⚙️ 一般設定 & 打刻規則
                </h3>
                
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  サイト名 (site_name)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  システムの名称です。ブラウザのタブ、ログイン画面、ヘッダー、通知メールの送信者名等に表示されます。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: 必須入力。空欄不可。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  サイトのサブタイトル (site_subtitle)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  システムの補足説明です。ログイン画面やヘッダーの下部等に表示されます。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: 必須入力。空欄不可。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  シフト開始前チェックイン許容時間 (shift_checkin_early_minutes)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  予定されているシフト開始時刻の何分前から出勤打刻を許可するかを設定します。これより早い打刻はエラーとなります。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: 0〜120の整数。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  連続打刻クールダウン (punch_cooldown_seconds)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  同一カードで連続して打刻した際、重複打刻とみなして無視する時間（秒）です。これにより、誤って2度かざしてしまった場合の誤入力を防ぎます。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: 0〜3600の整数。0にするとクールダウンは無効になります。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  打刻結果表示時間 (punch_result_display_seconds)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  打刻完了（またはエラー）メッセージを画面に表示し続ける秒数です。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: 1〜300の整数。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  ログイン継続時間 (login_token_expire_hours)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  ユーザーがログインした状態（JWTアクセストークン）の有効期限を設定します。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: 1〜8760の整数（時間）。デフォルトは 168時間（7日間）。最大365日。</span>
                  <br />
                  新しくログインしたセッションに対して適用されます。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  Google新規登録の許可 (enable_google_signup)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  Googleログイン時の新規ユーザー自動登録（アカウント作成）の許可・禁止を切り替えます。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: トグルスイッチで切り替え。</span>
                  <br />
                  無効（OFF）にすると、登録済みのユーザーのみGoogleログインが可能になり、未登録のGoogleアカウントからの新規登録は拒否されます。
                </p>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  📅 シフトカレンダー同期設定
                </h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                  Googleカレンダー等の外部カレンダーからシフト予定をインポートするための設定です。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  iCal 同期 URL (shift_ical_url)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  外部カレンダーが提供する、公開された iCal 形式（.ics）の URL を指定します。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: http:// または https:// で始まる有効なURL。空欄にすると同期は行われません。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  自動同期時刻 (shift_sync_time)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  毎日指定した時刻に、設定された iCal URL から最新のシフトを自動で取得・同期します。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: HH:MM 形式（例: 03:00）。空欄にすると自動同期は無効になります。</span>
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  直ちに同期する (手動同期)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  iCal 同期 URL からシフト予定を直ちに手動で取り込みます。自動同期の時間を待たずに今すぐデータを反映させたい場合や、設定した iCal 同期 URL から正しくデータが取得できるかを確認したい場合にクリックします。
                  <br />
                  同期結果（追加・更新・削除・スキップ件数）やエラー詳細を即座に確認できます。
                </p>
              </div>
            )}

            {activeTab === 'notification' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  ✉️ 月次勤怠レポート自動メール通知
                </h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                  設定された日時に、全従業員へ当月の勤務実績レポートをメール送信します。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  自動メール通知のON/OFF
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  <strong>「月末の自動メール通知を有効にする」</strong>スイッチをONにすることで通知が有効化され、OFFにすると無効化されます。
                  <br />
                  スイッチがOFFの間は、自動通知時刻の設定は無視され、メールは送信されません。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.25rem 0' }}>
                  自動通知時刻 (monthly_report_time)
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  スイッチがONのとき、毎月末日の指定された時刻にメールが配信されます。送信対象はアクティブな従業員（管理者は除外）かつメールアドレスが登録されているユーザーです。
                  <br />
                  <span style={{ color: '#dc2626', fontWeight: '500' }}>⚠️ 制限: スイッチがONの場合、HH:MM 形式（例: 20:00）で指定してください。</span>
                </p>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#eff6ff',
                  borderLeft: '4px solid #3b82f6',
                  fontSize: '0.85rem',
                  color: '#1e40af',
                  marginTop: '1.5rem'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>📧 通知される主なデータ</strong>
                  <ul>
                    <li>当月の勤務日数 (実際に打刻が行われた日数)</li>
                    <li>当月の総勤務時間 (端数処理適用後の労働時間合計)</li>
                    <li>当年4月1日（または前年4月1日）から当月末までの累計労働時間</li>
                  </ul>
                </div>
              </div>
            )}

            {activeTab === 'backup' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  💾 設定のインポート／エクスポート & DBバックアップ
                </h3>
                
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>
                  設定のインポート／エクスポート
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  一般設定、打刻規則、シフトカレンダー、メール通知設定などを JSON 形式でPCに保存（エクスポート）し、別の環境に適用（インポート）することができます。
                  <br />
                  インポート時は、適用前に<strong>「変更プレビュー画面」</strong>が表示され、管理者による確認を経てから適用されます。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#dc2626', margin: '1.5rem 0 0.5rem 0' }}>
                  ⚠️ データベースのフルバックアップ（SQLite）
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  勤怠記録、ユーザー情報、NFCカード登録情報を含む<strong>システム全体の全データ</strong>（SQLite の db ファイル）をバックアップおよび復元します。
                </p>
                
                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  borderLeft: '4px solid #ef4444',
                  fontSize: '0.85rem',
                  color: '#991b1b',
                  marginTop: '1rem'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>🚨 データベース復元時の重大な注意</strong>
                  データベースを復元すると、<strong>既存の全データがバックアップファイルの内容で完全に上書きされ、上書き前の状態には戻せません。</strong> 復元作業は十分に注意して行ってください。
                </div>
              </div>
            )}

            {activeTab === 'device' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🔒 打刻端末制限と登録機能
                </h3>
                <p style={{ fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                  セキュリティ上、許可された特定の端末（ブラウザ）からのみ打刻ページ（未ログイン待ち受け画面）を開けるように制限します。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>
                  仕組み
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  サーバーには端末の識別情報は保存されません。代わりに、管理者がこの画面で登録を行った際、バックエンドが署名した長期有効な <strong>Device Punch Token (JWT)</strong> がブラウザの <code>localStorage</code> に保存されます。
                  <br />
                  打刻画面を開く際、このトークンの署名が正しいか（管理者が許可した有効なトークンか）が検証されます。
                </p>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>
                  端末の登録手順
                </h4>
                <ol style={{ paddingLeft: '1.25rem', fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                  <li style={{ marginBottom: '0.25rem' }}>打刻端末に設定したいPC・タブレットのブラウザで管理者ログインし、システム設定を開きます。</li>
                  <li style={{ marginBottom: '0.25rem' }}>「打刻端末管理」セクションで、任意の「端末名」（例: 1F受付用タブレット）を入力します。</li>
                  <li style={{ marginBottom: '0.25rem' }}><strong>「登録」</strong>ボタンをクリックします。これでこの端末で打刻画面へのアクセスが許可されます。</li>
                </ol>

                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>
                  登録の解除
                </h4>
                <p style={{ fontSize: '0.9rem', margin: '0' }}>
                  登録済みの端末では、設定画面から<strong>「現在の端末の登録を取り消す」</strong>ボタンをクリックすることで、ブラウザから登録情報（トークン）を削除し、打刻端末としての許可を取り消すことができます。
                </p>
              </div>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="settings-guide-footer" style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            type="button"
            className="settings-btn settings-btn--secondary"
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
