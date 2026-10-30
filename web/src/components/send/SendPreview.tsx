import type { PreparedFile } from '../../services/sendFlow';
import { Button } from '../common/Button';

export function SendPreview({
  to,
  subject,
  files,
  packedBytes,
  mode,
  onBack,
  onSend,
}: {
  to: string;
  subject: string;
  files: PreparedFile[];
  packedBytes: number;
  mode: 'attach' | 'link';
  onBack: () => void;
  onSend: () => void;
}) {
  const memos = files.reduce((sum, file) => sum + file.memoCount, 0);
  return (
    <div>
      <h3>이 주소로 보낼까요?</h3>
      <p style={{ fontSize: 18 }}>{to}</p>
      <p>{subject}</p>
      <p>
        PDF {files.length}개를 압축 1개({(packedBytes / (1024 * 1024)).toFixed(1)}MB)로 보냅니다. 메모 {memos}개 ·{' '}
        {mode === 'attach' ? '메일 첨부' : 'Drive 링크'}
      </p>
      <p className="help">본문은 압축 맨 위에 있습니다. 별첨과 규정은 파일이 있을 때만 폴더로 들어갑니다.</p>
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
              <td>{(file.bytes.byteLength / 1024).toFixed(0)}KB</td>
              <td>{file.memoCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
