import { useState, useEffect, useRef } from 'react';
import './AttendancePage.css'; // 既存のスタイルと統合

interface AttendanceGuideModalProps {
  isAdmin: boolean;
  onClose: () => void;
}

type AdminTabType = 'admin_modify' | 'admin_approve' | 'admin_lock' | 'admin_csv_import' | 'history' | 'source';
type EmpTabType = 'emp_request' | 'emp_status' | 'history' | 'source' | 'emp_lock';
type TabType = AdminTabType | EmpTabType;

export function AttendanceGuideModal({ isAdmin, onClose }: AttendanceGuideModalProps) {
  // 初期タブをロールごとに設定
  const [activeTab, setActiveTab] = useState<TabType>(isAdmin ? 'admin_modify' : 'emp_request');
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
          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
          color: '#ffffff'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>📖</span>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.025em' }}>
              勤怠管理画面 使い方ガイド ({isAdmin ? '管理者向け' : '従業員向け'})
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
            {isAdmin ? (
              // 管理者向けタブメニュー
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin_modify')}
                  className={`guide-tab-btn ${activeTab === 'admin_modify' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'admin_modify')}
                >
                  <span>✏️</span> 勤怠の直接追加・修正
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin_approve')}
                  className={`guide-tab-btn ${activeTab === 'admin_approve' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'admin_approve')}
                >
                  <span>📋</span> 申請の承認・却下
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin_lock')}
                  className={`guide-tab-btn ${activeTab === 'admin_lock' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'admin_lock')}
                >
                  <span>🔒</span> 月次の締め処理
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin_csv_import')}
                  className={`guide-tab-btn ${activeTab === 'admin_csv_import' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'admin_csv_import')}
                >
                  <span>📥</span> 報告書CSVインポート
                </button>
              </>
            ) : (
              // 一般従業員向けタブメニュー
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('emp_request')}
                  className={`guide-tab-btn ${activeTab === 'emp_request' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'emp_request')}
                >
                  <span>✏️</span> 勤怠の修正申請
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('emp_status')}
                  className={`guide-tab-btn ${activeTab === 'emp_status' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'emp_status')}
                >
                  <span>🔔</span> 申請状況の確認
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('emp_lock')}
                  className={`guide-tab-btn ${activeTab === 'emp_lock' ? 'active' : ''}`}
                  style={getTabStyle(activeTab === 'emp_lock')}
                >
                  <span>🔒</span> 締め処理と制限
                </button>
              </>
            )}

            {/* 共通のタブメニュー */}
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`guide-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
              style={getTabStyle(activeTab === 'history')}
            >
              <span>🕒</span> 履歴（変更ログ）の意味
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('source')}
              className={`guide-tab-btn ${activeTab === 'source' ? 'active' : ''}`}
              style={getTabStyle(activeTab === 'source')}
            >
              <span>🏷️</span> 打刻元（Source）とは
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
            {/* === 管理者用タブコンテンツ === */}
            {activeTab === 'admin_modify' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  ✏️ 勤怠の直接追加・修正・削除
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  管理者は、従業員の勤怠データを修正申請を通さずに直接編集することができます。
                </p>
                
                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>直接修正・削除手順:</h4>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    日別詳細カレンダーから、対象日の <strong>「修正」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    表示される入力フォームで、修正後の出勤・退勤時刻を入力して保存します。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    不要な打刻レコードは <strong>「削除」</strong> ボタンで直接削除できます。
                  </li>
                </ol>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>新規追加手順:</h4>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  打刻漏れ等でレコードが存在しない日（欠勤または未打刻日）に、新しく勤務データを登録できます。
                </p>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    詳細カレンダーの右端にある緑色の <strong>「追加」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    出勤時刻と退勤時刻を入力し、<strong>「保存」</strong> をクリックします。
                  </li>
                </ol>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  borderLeft: '4px solid #ef4444',
                  fontSize: '0.85rem',
                  color: '#991b1b',
                  marginTop: '1.5rem',
                  marginBottom: '1rem'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>⚠️ 注意: 締め処理（ロック）中の制限</strong>
                  対象月がすでに「締め済」状態になっている場合は、直接修正や追加・削除操作を行うことはできません。一度「締めを解除」した上で操作を行ってください。
                </div>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#fffbeb',
                  borderLeft: '4px solid #d97706',
                  fontSize: '0.85rem',
                  color: '#92400e'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>⚡️ 重複エラー（ATTENDANCE_OVERLAP）について</strong>
                  すでに登録されている他の出退勤時間帯と一部でも重なる時刻で新規追加や修正を行おうとするとエラーになります。先に既存のレコードを修正または削除して調整を行ってください。
                </div>
              </div>
            )}

            {activeTab === 'admin_approve' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  📋 修正申請の承認・却下フロー
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  従業員から提出された修正申請は、管理者の審査（承認または却下）を経てデータに反映されます。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>承認手順:</h4>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    「修正申請の承認・履歴」セクションの <strong>「承認待ち」</strong> タブから、対象の申請を確認します。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    行の右側にある <strong>「承認」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    確認画面で変更前・変更後の時刻および、勤務時間の増減（プレビュー）を確認します。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    必要に応じて <strong>「承認コメント」</strong>（任意）を入力し、承認を確定します。承認されると自動的に勤怠データが更新され、監査ログが記録されます。
                  </li>
                </ol>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>却下手順:</h4>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    対象の申請の <strong>「却下」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    従業員へ理由を伝えるため、<strong>「却下コメント (必須)」</strong> を入力して却下を確定します。
                  </li>
                </ol>
              </div>
            )}

            {activeTab === 'admin_lock' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🔒 月次の締め処理（ロック）
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  給与計算の確定時などに、過去の勤務データが誤って変更されないよう、月単位でデータをロック（締め処理）することができます。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>締め処理（ロック）を実行する:</h4>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  日別勤怠詳細の上部にある <strong>「月を締める」</strong> ボタンをクリックします。
                </p>
                <ul style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#475569' }}>
                  <li>締め処理を行うと、一般従業員による修正申請・申請キャンセルおよび管理者による直接編集（PATCH）、申請の承認・却下が完全にロックされます。</li>
                  <li>締め処理の際、まだ承認待ち（pending）の申請が残っている場合は、システムにより自動的に却下処理されます（却下コメントに締め処理完了に伴う自動却下である旨が記載されます）。</li>
                </ul>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>締め処理を解除する:</h4>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  締め済の月を表示しているときに表示される <strong>「締めを解除」</strong> ボタンをクリックすると、ロックが解除され、再度データの編集や申請の承認が可能になります。
                </p>
              </div>
            )}

            {activeTab === 'admin_csv_import' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  📥 勤務時間報告書 CSV の一括インポート
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  『教学系予算パートタイム職員等 勤務時間報告書』形式の CSV ファイルをアップロードし、複数の従業員の出退勤打刻を一括で登録・更新できます。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>インポート手順:</h4>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    勤怠管理画面の右上にある <strong>「📥 報告書CSVインポート」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    ダイアログから対象の CSV ファイル（<code>.csv</code>）を選択し、<strong>「インポート実行」</strong> をクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    処理完了後、反映成功件数および登録アカウントが見つからなかった氏名一覧が報告されます。
                  </li>
                </ol>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>取り扱い仕様・ルール:</h4>
                <ul style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>氏名のスペース無視:</strong> 氏名に含まれる全角・半角スペースやタブは自動除去され、登録済みアカウント（<code>User.full_name</code>）と照合されます。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>重複データの上書き:</strong> 同一ユーザーの同一勤務日に既に勤怠記録が存在する場合、出退勤打刻が最新データで上書き更新されます。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>未登録ユーザーの報告:</strong> 登録アカウントに見つからなかった氏名はインポートがスキップされ、モーダル上に未一致氏名としてリスト表示されます。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>実働時間数:</strong> CSV内の「実働時間数」列は無視され、出退勤打刻に基づき勤務時間・丸め処理が自動計算されます。
                  </li>
                </ul>
              </div>
            )}



            {/* === 一般従業員用タブコンテンツ === */}
            {activeTab === 'emp_request' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  ✏️ 勤怠の修正申請
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  打刻忘れや押し間違い等があった場合、管理者へ修正申請を提出することができます。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>申請手順:</h4>
                <ol style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    日別勤怠詳細の一覧から、修正したい日の <strong>「修正申請」</strong> ボタンをクリックします。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    修正後の出勤・退勤時刻（希望時刻）を指定します。
                    <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem' }}>
                      <li>片方だけの修正も可能です。</li>
                      <li>余分な打刻を消したい場合は <strong>「クリア」</strong> ボタンを使用します。</li>
                      <li>入力を元に戻したい場合は <strong>「リセット」</strong> ボタンで初期値に戻せます。</li>
                    </ul>
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    <strong>「申請理由 (必須)」</strong>（例: 「退勤の押し忘れ」等）を詳しく入力します。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    勤務時間の差分プレビュー（例: <code>+1.50h</code> など）を確認し、間違いがなければ <strong>「申請する」</strong> をクリックします。
                  </li>
                </ol>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#eff6ff',
                  borderLeft: '4px solid #3b82f6',
                  fontSize: '0.85rem',
                  color: '#1e40af',
                  marginTop: '1.5rem',
                  marginBottom: '1rem'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>💡 1日に複数回の打刻がある場合</strong>
                  中抜けなどにより1日に複数の勤務レコードが記録されている場合は、各レコードの横にある「修正申請」ボタンから、それぞれのレコードごとに個別の申請が可能です。
                </div>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#fffbeb',
                  borderLeft: '4px solid #d97706',
                  fontSize: '0.85rem',
                  color: '#92400e'
                }}>
                  <strong style={{ display: 'block', marginBottom: '0.25rem' }}>⚡️ 重複エラー（ATTENDANCE_OVERLAP）について</strong>
                  申請する希望時刻が、同じ日の他の勤務時間帯と一部でも重複している場合、申請時にエラーが発生して送信できません。他の勤務レコードの時間帯と重ならないように指定してください。
                </div>
              </div>
            )}

            {activeTab === 'emp_status' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🔔 申請状況の確認とステータス
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  申請後の状況は、画面上部の「自分の修正申請・履歴」セクション、および詳細カレンダーのステータスバッジで確認できます。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>ステータスの意味:</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="att-corr-badge att-corr-badge--pending" style={{ width: '80px', textAlign: 'center' }}>承認待ち</span>
                    <span style={{ fontSize: '0.85rem' }}>管理者が審査中です。この状態の間は、同じレコードに対する再度の申請は行えません。（「取消」ボタンから申請を取り消すことは可能です）</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="att-corr-badge att-corr-badge--approved" style={{ width: '80px', textAlign: 'center' }}>承認済み</span>
                    <span style={{ fontSize: '0.85rem' }}>管理者に承認されました。自動的にカレンダーのデータが更新され、打刻元が「自己申告」に変わります。</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="att-corr-badge att-corr-badge--rejected" style={{ width: '80px', textAlign: 'center' }}>却下済み</span>
                    <span style={{ fontSize: '0.85rem' }}>申請が差し戻されました。「承認/却下者・コメント」列に記載されている却下理由を確認し、必要に応じて修正して再申請してください。</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'emp_lock' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🔒 締め処理（ロック）と制限
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  管理者が月次の締め処理（ロック）を行うと、該当年月のデータはすべて保護され、書き換えができなくなります。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>制限事項:</h4>
                <ul style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>
                    🔒 締め済の月については、<strong>「修正申請」の提出および「申請のキャンセル」が一切行えなくなります</strong>（ボタンが非活性になります）。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    締め処理が実行された時点で承認待ち（pending）状態の申請が残っていた場合、システムにより<strong>自動的に却下（却下理由: 締め処理完了による自動却下）</strong>されます。
                  </li>
                  <li style={{ marginBottom: '0.5rem' }}>
                    どうしても修正が必要な場合は、管理者に締め処理の解除を依頼してください。
                  </li>
                </ul>
              </div>
            )}


            {/* === 共通タブコンテンツ === */}
            {activeTab === 'history' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🕒 履歴（変更ログ）の意味
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  勤務データの変更履歴（監査ログ）を確認するための機能です。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>履歴の確認方法:</h4>
                <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                  カレンダー一覧の各行にある <strong>「履歴」</strong> ボタンをクリックすると、そのレコードが作成・変更された全ての履歴がタイムライン形式で表示されます。
                </p>

                <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b', margin: '1rem 0 0.5rem 0' }}>記録される内容:</h4>
                <ul style={{ paddingLeft: '1.25rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                  <li style={{ marginBottom: '0.5rem' }}>変更が実行された日時、および実行したユーザー名</li>
                  <li style={{ marginBottom: '0.5rem' }}>変更前後の出勤・退勤時刻</li>
                  <li style={{ marginBottom: '0.5rem' }}>従業員の申請理由、および管理者の承認・却下コメント</li>
                </ul>

                <div style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.85rem',
                  color: '#475569',
                  marginTop: '1.5rem'
                }}>
                  ℹ️ <strong>監査証跡（監査トレール）の目的</strong><br />
                  給与計算の元となる勤務データに対して「いつ、だれが、どのような目的で」データを書き換えたかを不変ログとして保持し、運用の透明性と信頼性を高めるために自動で記録されています。
                </div>
              </div>
            )}

            {activeTab === 'source' && (
              <div className="guide-section animate-fade-in">
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: '700', color: '#1e293b' }}>
                  🏷️ 打刻元（Source）とは
                </h3>
                <p style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                  勤怠データが「どのような手段で登録されたか」を示す識別子です。打刻された背景を確認するために利用されます。
                </p>

                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.9rem',
                  marginBottom: '1.25rem'
                }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600' }}>打刻元の表示</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600' }}>詳細・意味</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600' }}>NFC (PaSoRi)</td>
                      <td style={{ padding: '0.75rem' }}>打刻端末に設置されたICカードリーダーにICカードをかざして行った正規の打刻。</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600' }}>Web打刻 (ID入力)</td>
                      <td style={{ padding: '0.75rem' }}>ブラウザの打刻画面から、手動でIDを入力して行った打刻。</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600' }}>自己申告</td>
                      <td style={{ padding: '0.75rem' }}>従業員自身が「修正申請」を行い、管理者がそれを承認して反映された記録。</td>
                    </tr>
                    {isAdmin && (
                      <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem', fontWeight: '600' }}>管理者修正</td>
                        <td style={{ padding: '0.75rem' }}>管理者が詳細画面から直接レコードを追加または編集した記録。</td>
                      </tr>
                    )}
                    <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600' }}>自動補完</td>
                      <td style={{ padding: '0.75rem' }}>出勤打刻はあるが退勤打刻のない日跨ぎ時等に、システムが自動的に補完した記録。</td>
                    </tr>
                  </tbody>
                </table>

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
            className="att-btn att-btn--secondary"
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

// タブ選択時の動的スタイリング用ヘルパー
function getTabStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    border: 'none',
    borderRadius: '8px',
    background: isActive ? '#dbeafe' : 'transparent',
    color: isActive ? '#1d4ed8' : '#475569',
    fontWeight: isActive ? '600' : '500',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: '0.9rem',
    width: '100%'
  };
}
