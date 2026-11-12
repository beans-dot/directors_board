import type { PreparedFile } from '../../services/sendFlow';
import { Button } from '../common/Button';

export function SendPreview({
  to,
  subject,
  files,
  packedBytes,
  mode,
  sourceUrl,
  packUrl,
  packNote,
  onBack,
  onSend,
}: {
  to: string;
  subject: string;
  files: PreparedFile[];
  packedBytes: number;
  mode: 'attach' | 'link';
  sourceUrl: string;
  packUrl?: string;
  packNote?: string;
  onBack: () => void;
  onSend: () => void;
}) {
  const memos = files.reduce((sum, file) => sum + file.memoCount, 0);
  return (
    <div className="send-preview">
      <h3>이 주소로 보낼까요?</h3>
      <p style={{ fontSize: 18 }}>{to}</p>
      <p>{subject}</p>
      <p>
        PDF {files.length}개를 압축 1개({(packedBytes / (1024 * 1024)).toFixed(1)}MB)로 보냅니다. 메모 {memos}개 ·{' '}
        {mode === 'attach' ? '메일 첨부' : 'Drive 링크'}
      </p>
      {packNote && <p className="help">{packNote}</p>}
      <p className="help">본문은 압축 맨 위에 있습니다. 별첨과 규정은 파일이 있을 때만 폴더로 들어갑니다.</p>
      {packUrl && (
        <p className="help">
          압축파일{' '}
          <a href={packUrl} target="_blank" rel="noopener noreferrer">
            {packUrl}
          </a>
        </p>
      )}
      <p className="help">
        원본 자료{' '}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          {sourceUrl}
        </a>
      </p>
      <div className="send-file-list">
        <table className="data">
          <thead>
            <tr>
              <th>폴더</th>
              <th>파일</th>
              <th>용량</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.path}>
                <td>{file.topFolder}</td>
                <td>{file.name}</td>
                <td>{(file.size / 1024).toFixed(0)}KB</td>
                <td>{file.memoCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="send-actions">
        <Button variant="line" type="button" onClick={onBack}>
          돌아가기
        </Button>
        <Button variant="primary" type="button" onClick={onSend}>
          보내기
        </Button>
      </div>
    </div>
  );
}
