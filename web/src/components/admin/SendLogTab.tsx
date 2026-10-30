import { useAdmin } from '../../state/admin';

export function SendLogTab() {
  const sends = useAdmin((state) => state.sends);
  return (
    <table className="data">
      <thead>
        <tr>
          <th>시각</th>
          <th>이름</th>
          <th>날짜폴더</th>
          <th>받는주소</th>
          <th>첨부수</th>
          <th>용량</th>
          <th>방식</th>
          <th>결과</th>
        </tr>
      </thead>
      <tbody>
        {sends.map((row, index) => (
          <tr key={`${row.at}-${index}`} style={{ color: String(row.result).includes('실패') ? 'var(--danger)' : undefined }}>
            <td>{row.at}</td>
            <td>{row.name}</td>
            <td>{row.folderDate}</td>
            <td>{row.to}</td>
            <td>{row.fileCount}</td>
            <td>{row.bytes}</td>
            <td>{row.mode}</td>
            <td>
              {row.result} {row.error}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
