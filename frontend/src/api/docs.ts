export interface GuideDocResponse {
  title: string;
  content: string;
}

export async function fetchAttendanceGuide(token: string): Promise<GuideDocResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/v1/docs/attendance-guide', {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || '使い方の取得に失敗しました。');
  }

  return res.json();
}
