import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonthlyCommentPanel } from './MonthlyCommentPanel';
import * as attendanceApi from '../../api/attendance';

vi.mock('../../api/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/attendance')>();
  return {
    ...actual,
    getMonthlyComment: vi.fn(),
    saveMonthlyComment: vi.fn(),
  };
});

const token = 'test-token';
const yearMonth = '2026-06';

describe('MonthlyCommentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('本文と最終更新者名が表示される', async () => {
    vi.mocked(attendanceApi.getMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: '来月から出勤時間を変更予定です。',
      updated_by_user_id: 'admin-1',
      updated_by_name: '管理者太郎',
      updated_at: '2026-06-10T01:23:45',
    });

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText('来月から出勤時間を変更予定です。')).toBeInTheDocument();
    });
    expect(screen.getByText(/最終更新: 管理者太郎/)).toBeInTheDocument();
  });

  it('5行を超える本文は先頭5行のみ表示され、トグルで全文を展開・折りたたみできる', async () => {
    const lines = ['1行目', '2行目', '3行目', '4行目', '5行目', '6行目', '7行目'];
    vi.mocked(attendanceApi.getMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: lines.join('\n'),
      updated_by_user_id: 'admin-1',
      updated_by_name: '管理者太郎',
      updated_at: '2026-06-10T01:23:45',
    });

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText(/1行目/)).toBeInTheDocument();
    });
    expect(screen.getByText(/5行目/)).toBeInTheDocument();
    expect(screen.queryByText(/6行目/)).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /続きを表示（全7行）/ });
    fireEvent.click(toggle);
    expect(screen.getByText(/7行目/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /折りたたむ/ }));
    expect(screen.queryByText(/6行目/)).not.toBeInTheDocument();
  });

  it('5行以下の本文にはトグルが表示されない', async () => {
    vi.mocked(attendanceApi.getMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: ['1行目', '2行目', '3行目', '4行目', '5行目'].join('\n'),
      updated_by_user_id: 'admin-1',
      updated_by_name: '管理者太郎',
      updated_at: '2026-06-10T01:23:45',
    });

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText(/5行目/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /続きを表示/ })).not.toBeInTheDocument();
  });

  it('未登録の場合「メモはありません」と表示される', async () => {
    vi.mocked(attendanceApi.getMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: '',
      updated_by_user_id: null,
      updated_by_name: null,
      updated_at: null,
    });

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText('メモはありません')).toBeInTheDocument();
    });
    expect(screen.queryByText(/最終更新:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ メモを追加' })).toBeInTheDocument();
  });

  it('編集→入力→保存で saveMonthlyComment が呼ばれ表示が更新される', async () => {
    vi.mocked(attendanceApi.getMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: '旧メモ',
      updated_by_user_id: 'admin-1',
      updated_by_name: '管理者太郎',
      updated_at: '2026-06-10T01:23:45',
    });
    vi.mocked(attendanceApi.saveMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: '新しいメモ',
      updated_by_user_id: 'admin-2',
      updated_by_name: '管理者次郎',
      updated_at: '2026-06-11T02:00:00',
    });

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText('旧メモ')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '✏️ 編集' }));

    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: '新しいメモ' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(attendanceApi.saveMonthlyComment).toHaveBeenCalledWith(token, {
        year_month: yearMonth,
        body: '新しいメモ',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('新しいメモ')).toBeInTheDocument();
    });
    expect(screen.getByText(/最終更新: 管理者次郎/)).toBeInTheDocument();
  });

  it('空で保存時に confirm でキャンセルすると API が呼ばれない', async () => {
    vi.mocked(attendanceApi.getMonthlyComment).mockResolvedValue({
      year_month: yearMonth,
      body: '既存メモ',
      updated_by_user_id: 'admin-1',
      updated_by_name: '管理者太郎',
      updated_at: '2026-06-10T01:23:45',
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText('既存メモ')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '✏️ 編集' }));

    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: '   ' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith('メモを削除しますか？');
    });
    expect(attendanceApi.saveMonthlyComment).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('取得失敗時にエラーが表示される', async () => {
    vi.mocked(attendanceApi.getMonthlyComment).mockRejectedValue(new Error('サーバーエラー'));

    render(<MonthlyCommentPanel token={token} yearMonth={yearMonth} />);

    await waitFor(() => {
      expect(screen.getByText('サーバーエラー')).toBeInTheDocument();
    });
  });
});
